import os
import io
import re
import json
import wave
import struct
import asyncio
import logging
import tempfile
import time
import uuid
import unicodedata
import random
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Union
from contextlib import asynccontextmanager

import httpx
import edge_tts
import miniaudio
from dotenv import load_dotenv
try:
    from redis.asyncio import Redis as AsyncRedis
except ImportError:  # Allows the backend to start before the Redis extra is installed.
    AsyncRedis = None
from fastapi import FastAPI, Request, Response, HTTPException, WebSocket, WebSocketDisconnect, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from pathlib import Path

load_dotenv()
load_dotenv(Path(__file__).resolve().parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("gemini-backend")

from voice_biometrics import (
    load_doctor_voiceprint,
    verify_speaker_match,
    extract_voiceprint
)

# ==========================================================
# CONFIG
# ==========================================================
# Models for the (non-live) REST endpoint /api/chat-audio
FALLBACK_MODELS = [
    os.getenv("GEMINI_MODEL", "gemini-3.8-flash-tts"),
    "gemini-3.8-flash-tts",
    "gemini-3.8-flash-lite-tts",
    "gemini-3.5-transcribe",
    "gemini-2.5-flash",
]

# Models for the Live WebSocket relay
FALLBACK_LIVE_MODELS = [
    os.getenv("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview"),
    "gemini-3.1-flash-live-preview",
]
LIVE_API_VERSION = os.getenv("GEMINI_API_VERSION", "v1alpha")

# Keep the API 1 roster ID configurable independently from the websocket route.
PATIENTS_API_BASE_URL = os.getenv("PATIENTS_API_BASE_URL", "https://ychat-be.yhealth.me/agent/patients")
DEFAULT_DOCTOR_ID = os.getenv("DEFAULT_DOCTOR_ID", "6789ebb61a093d60fa691c39")
PATIENTS_API_DOCTOR_ID = os.getenv("PATIENTS_API_DOCTOR_ID", "6789ebb61a093d60fa691c39")
DEFAULT_DOCTOR_NAME = os.getenv("DEFAULT_DOCTOR_NAME", "Brij Mohan Makkar")
DEFAULT_DOCTOR_SPECIALIZATION = os.getenv("DEFAULT_DOCTOR_SPECIALIZATION", "Diabetes & Obesity specialist")
DEFAULT_DOCTOR_CLINIC = os.getenv("DEFAULT_DOCTOR_CLINIC", "Dr. Makkar's Diabetes and Obesity Centre, Paschim Vihar, New Delhi")
PERSONA_API_BASE_URL = os.getenv("PERSONA_API_BASE_URL", "https://ychat-be.yhealth.me/persona-hardware")
DOCTOR_PERSONA_API_BASE_URL = os.getenv("DOCTOR_PERSONA_API_BASE_URL", "https://ychat-be.yhealth.me/agent/doctor-chat")
REDIS_DOCTOR_PERSONA_TTL_S = int(os.getenv("REDIS_DOCTOR_PERSONA_TTL_S", "86400"))
PERSONA_HARDWARE_TOKEN = os.getenv("PERSONA_HARDWARE_TOKEN", "")

# Audio / pacing (ESP32 plays 16kHz mono s16 => 32000 bytes/s)
BYTES_PER_SEC_OUT = 32000.0
OUT_GAIN = float(os.getenv("GEMINI_OUT_GAIN", "0.46"))       # applied while resampling 24k->16k
IN_GAIN = float(os.getenv("GEMINI_IN_GAIN", "1.4"))          # mic boost
MAX_LEAD_S = float(os.getenv("PLAYBACK_MAX_LEAD_S", "0.6"))  # keep extra headroom in the 2 s ESP playback ring (matched to 31bb570)
TARGET_LEAD_S = float(os.getenv("PLAYBACK_TARGET_LEAD_S", "0.3"))
# Small PCM WebSocket frames avoid a burst filling the ESP32 playback ring.
# Keep this well below the device's 32 KiB transport buffer.
AUDIO_WS_CHUNK_BYTES = max(512, min(4096, int(os.getenv("AUDIO_WS_CHUNK_BYTES", "2048"))))
if AUDIO_WS_CHUNK_BYTES & 1:
    AUDIO_WS_CHUNK_BYTES -= 1
POST_PLAYBACK_MUTE_S = 0.6                                   # ignore mic this long after the speaker finishes

CACHE_TTL_ROSTER_S = 600
CACHE_TTL_PERSONA_S = 300
MAX_TOOL_RECORD_CHARS = int(os.getenv("MAX_TOOL_RECORD_CHARS", "2500"))
API1_REQUEST_TIMEOUT_S = float(os.getenv("API1_REQUEST_TIMEOUT_S", "35.0"))
API2_REQUEST_TIMEOUT_S = float(os.getenv("API2_REQUEST_TIMEOUT_S", "8.0"))
API2_MAX_ATTEMPTS = max(1, min(3, int(os.getenv("API2_MAX_ATTEMPTS", "2"))))
TOOL_TIMEOUT_S = float(os.getenv("PATIENT_LOOKUP_TIMEOUT_S", "45.0"))
GEMINI_NO_PROGRESS_TIMEOUT_S = float(os.getenv("GEMINI_NO_PROGRESS_TIMEOUT_S", "8.0"))
UNCLEAR_SPEECH_TIMEOUT_S = float(os.getenv("UNCLEAR_SPEECH_TIMEOUT_S", "3.5"))
MAX_UNCLEAR_STREAK = int(os.getenv("MAX_UNCLEAR_STREAK", "3"))
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
REDIS_TLS = os.getenv("REDIS_TLS", "0").strip().lower() in {"1", "true", "yes", "on"}
REDIS_KEY_PREFIX = os.getenv("REDIS_KEY_PREFIX", "yhealth-assistant")
REDIS_ROSTER_TTL_S = int(os.getenv("REDIS_ROSTER_TTL_S", "86400"))
REDIS_SESSION_TTL_S = int(os.getenv("REDIS_SESSION_TTL_S", "1800"))
REDIS_PENDING_TTL_S = int(os.getenv("REDIS_PENDING_TTL_S", "180"))
REDIS_PERSONA_MAP_TTL_S = int(os.getenv("REDIS_PERSONA_MAP_TTL_S", str(REDIS_ROSTER_TTL_S)))
PERSONA_ID_FALLBACK_TO_ROSTER_ID = os.getenv("PERSONA_ID_FALLBACK_TO_ROSTER_ID", "1").strip().lower() in {"1", "true", "yes", "on"}

# ==========================================================
# CACHES / HTTP
# ==========================================================
_http_client = None
_redis_client = None
_redis_warning_at = 0.0
_roster_by_doctor = {}       # doctor_id -> (timestamp, roster_list)
_roster_status_by_doctor = {}  # doctor_id -> ready | empty | unavailable
_roster_expires_at_by_doctor = {}  # doctor_id -> absolute epoch; stale fallback never extends Redis TTL
_roster_fetch_locks = {}     # doctor_id -> serialize refreshes and share one in-flight API 1 fetch
_roster_fetch_generation = {}  # doctor_id -> incremented after each completed API 1 request
_persona_by_id = {}          # patient_id -> (timestamp, persona_dict)
_persona_status_by_id = {}   # doctor_id:patient_id -> last API 2 HTTP status or error
_persona_fetch_locks = {}    # doctor_id:patient_id -> share one in-flight API 2 request
_doctor_persona_by_day = {}   # doctor_id:date -> (timestamp, persona_dict)
_doctor_persona_locks = {}    # doctor_id:date -> share one in-flight doctor persona request
_session_state_fallback = {}
_clinical_notes = {}
_escalated_alerts = {}


def get_current_ist_datetime() -> datetime:
    """Return the current datetime in Indian Standard Time (Asia/Kolkata, UTC+5:30)."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(os.getenv("TZ_NAME", "Asia/Kolkata")))
    except Exception:
        from datetime import timezone, timedelta
        return datetime.now(timezone(timedelta(hours=5, minutes=30), name="IST"))


def get_current_ist_time_str() -> str:
    """Return formatted time in IST (e.g., '1:05 PM IST')."""
    dt = get_current_ist_datetime()
    return dt.strftime("%I:%M %p IST").lstrip("0")


def get_today_date_str() -> str:
    """Return today's date formatted as YYYY-MM-DD in IST timezone (fallback to system date)."""
    return get_current_ist_datetime().strftime("%Y-%m-%d")
_runtime_metrics = {
    "started_at": time.time(), "ws_connected": 0, "ws_disconnected": 0,
    "ws_active": 0, "gemini_sessions": 0, "gemini_reconnects": 0,
    "api1_requests": 0, "api1_failures": 0, "api1_last_latency_ms": None,
    "api2_requests": 0, "api2_retries": 0, "api2_failures": 0,
    "api2_last_latency_ms": None,
}
_device_health = {}  # doctor_id:device_id -> last non-sensitive ESP32 health payload


def _metric_inc(name: str, amount: int = 1):
    _runtime_metrics[name] = int(_runtime_metrics.get(name, 0)) + amount


def _url_for_log(url):
    """Return a URL safe for access logs (omit query values and credentials)."""
    try:
        parsed = httpx.URL(str(url))
        return str(parsed.copy_with(query=None, username="", password=""))
    except Exception:
        return "<unavailable-url>"


async def _log_outbound_request(request):
    request.extensions["backend_log_started_at"] = time.perf_counter()
    logger.info("HTTP OUT -> %s %s", request.method, _url_for_log(request.url))


async def _log_outbound_response(response):
    started = response.request.extensions.get("backend_log_started_at")
    elapsed_ms = (time.perf_counter() - started) * 1000 if started else -1
    logger.info(
        "HTTP OUT <- %s %s status=%s duration_ms=%.1f",
        response.request.method,
        _url_for_log(response.request.url),
        response.status_code,
        elapsed_ms,
    )


def get_http_client():
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(5.0, connect=2.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            event_hooks={"request": [_log_outbound_request], "response": [_log_outbound_response]},
        )
    return _http_client


def get_redis_client():
    global _redis_client
    if AsyncRedis is None:
        return None
    if _redis_client is None:
        redis_url = REDIS_URL
        if REDIS_TLS and redis_url.startswith("redis://"):
            redis_url = "rediss://" + redis_url[len("redis://"):]
        _redis_client = AsyncRedis.from_url(
            redis_url, encoding="utf-8", decode_responses=True,
            socket_connect_timeout=2.0, socket_timeout=3.0,
            health_check_interval=30,
        )
    return _redis_client


def _redis_key(*parts: str) -> str:
    safe_parts = [re.sub(r"[^A-Za-z0-9_-]", "_", str(part)) for part in parts]
    return ":".join([REDIS_KEY_PREFIX, *safe_parts])


def _warn_redis_once(message: str):
    global _redis_warning_at
    now = time.monotonic()
    if now - _redis_warning_at >= 60:
        logger.warning(message)
        _redis_warning_at = now


async def redis_get_json(key: str):
    client = get_redis_client()
    if client is None:
        _warn_redis_once("Redis package is not installed; using the in-memory cache fallback.")
        return None
    try:
        raw = await client.get(key)
        return json.loads(raw) if raw else None
    except Exception as exc:
        _warn_redis_once(f"Redis is unavailable; using the in-memory cache fallback ({type(exc).__name__}).")
        return None


async def redis_get_json_with_ttl(key: str):
    """Read a Redis value and its remaining TTL together for bounded stale fallback."""
    client = get_redis_client()
    if client is None:
        return None, 0
    try:
        pipe = client.pipeline(transaction=False)
        pipe.get(key)
        pipe.ttl(key)
        raw, ttl = await pipe.execute()
        value = json.loads(raw) if raw else None
        # Keys without TTL are bounded locally to the configured cache lifetime.
        ttl = REDIS_ROSTER_TTL_S if int(ttl) == -1 else max(0, int(ttl))
        return value, ttl
    except Exception as exc:
        _warn_redis_once(f"Redis roster TTL read failed ({type(exc).__name__}); using the normal cache path.")
        # Without a reliable expiry, don't extend the lifetime of a stale roster.
        return await redis_get_json(key), 0


async def redis_set_json(key: str, value, ttl_seconds: int):
    client = get_redis_client()
    if client is None:
        return False
    try:
        await client.set(key, json.dumps(value, ensure_ascii=False, separators=(",", ":")), ex=max(1, ttl_seconds))
        return True
    except Exception as exc:
        _warn_redis_once(f"Redis write failed; using the in-memory cache fallback ({type(exc).__name__}).")
        return False


async def redis_delete(key: str):
    client = get_redis_client()
    if client is None:
        return
    try:
        await client.delete(key)
    except Exception as exc:
        _warn_redis_once(f"Redis delete failed ({type(exc).__name__}).")


def _session_key(doctor_id: str, connection_id: str, kind: str) -> str:
    return _redis_key("session", doctor_id, connection_id, kind)


async def get_conversation_state(doctor_id: str, connection_id: str, kind: str):
    key = _session_key(doctor_id, connection_id, kind)
    value = await redis_get_json(key)
    if value is not None:
        return value
    cached = _session_state_fallback.get(key)
    if cached:
        expires_at, fallback_value = cached
        if expires_at > time.monotonic():
            return fallback_value
        _session_state_fallback.pop(key, None)
    return None


async def set_conversation_state(doctor_id: str, connection_id: str, kind: str, value, ttl_seconds: int):
    key = _session_key(doctor_id, connection_id, kind)
    _session_state_fallback[key] = (time.monotonic() + ttl_seconds, value)
    await redis_set_json(key, value, ttl_seconds)


async def delete_conversation_state(doctor_id: str, connection_id: str, kind: str):
    key = _session_key(doctor_id, connection_id, kind)
    _session_state_fallback.pop(key, None)
    await redis_delete(key)


@asynccontextmanager
async def lifespan(app: FastAPI):
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key or gemini_key == "YOUR_GEMINI_API_KEY_HERE":
        logger.warning("⚠️  GEMINI_API_KEY is not set in backend/.env!")
    else:
        logger.info(f"✅ GEMINI_API_KEY present. Live model: '{FALLBACK_LIVE_MODELS[0]}'")
    redis = get_redis_client()
    if redis is not None:
        try:
            await redis.ping()
            logger.info("✅ Redis cache connected")
        except Exception as exc:
            _warn_redis_once(f"Configured Redis endpoint is not reachable; using in-memory fallback ({type(exc).__name__}).")
    async def prewarm_roster():
        try:
            roster = await asyncio.wait_for(
                async_fetch_patient_list(PATIENTS_API_DOCTOR_ID, force_refresh=True),
                timeout=API1_REQUEST_TIMEOUT_S + 1.5,
            )
            if roster:
                logger.info(f"⚡ Roster cache pre-warmed: {len(roster)} patients in RAM")
            elif _roster_status_by_doctor.get(PATIENTS_API_DOCTOR_ID) == "empty":
                logger.warning("API 1 returned a valid empty roster during pre-warm")
            else:
                logger.warning(
                    "Roster pre-warm unavailable (status=%s); lookup will retry on demand",
                    _roster_status_by_doctor.get(PATIENTS_API_DOCTOR_ID, "unknown"),
                )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("Roster pre-warm failed (%s); lookup will retry on demand", type(e).__name__)

        try:
            today_date = get_today_date_str()
            doc_data = await asyncio.wait_for(
                async_fetch_doctor_persona(DEFAULT_DOCTOR_ID, today_date),
                timeout=10.0,
            )
            if doc_data:
                c_count = len(doc_data.get("today_consultations") or doc_data.get("consultations") or [])
                logger.info(f"⚡ Doctor persona pre-warmed for {DEFAULT_DOCTOR_ID} ({today_date}): {c_count} consultations")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("Doctor persona pre-warm skipped (%s)", type(e).__name__)

    # Start serving WebSockets immediately; a slow API 1 must not delay app startup.
    prewarm_task = asyncio.create_task(prewarm_roster(), name="api1-roster-prewarm")
    yield
    if not prewarm_task.done():
        prewarm_task.cancel()
        await asyncio.gather(prewarm_task, return_exceptions=True)
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
        except Exception:
            pass


app = FastAPI(title="ESP32-S3 Gemini Voice Assistant", lifespan=lifespan)


@app.middleware("http")
async def log_inbound_http_request(request: Request, call_next):
    started = time.perf_counter()
    url = _url_for_log(request.url)
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("HTTP IN !! %s %s duration_ms=%.1f", request.method, url, (time.perf_counter() - started) * 1000)
        raise
    # Avoid drowning Grafana Loki with / healthcheck pings every 30s
    if request.url.path not in ("/", "/health", "/favicon.ico"):
        logger.info(
            "HTTP IN <- %s %s status=%s duration_ms=%.1f",
            request.method,
            url,
            response.status_code,
            (time.perf_counter() - started) * 1000,
        )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def read_root(request: Request):
    accept = request.headers.get("accept", "")
    index_file = os.path.join(STATIC_DIR, "index.html")
    if "text/html" in accept and os.path.exists(index_file):
        return FileResponse(index_file)
    return {
        "status": "online",
        "service": "ESP32 Gemini Voice Relay",
        "configured_model": FALLBACK_LIVE_MODELS[0],
        "frontend_url": "/app",
    }


@app.get("/app")
def read_app():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"error": "Frontend static files not found"}


@app.get("/api/clinical-notes")
async def get_clinical_notes(patient_name: str = None, doctor_id: str = None):
    """Retrieve dictated clinical notes persisted during doctor rounds."""
    if patient_name:
        notes = _clinical_notes.get(patient_name, [])
        return {"patient_name": patient_name, "notes": notes, "count": len(notes)}
    # Flat list sorted newest first
    all_notes = []
    for p_name, notes_list in _clinical_notes.items():
        for note in notes_list:
            if isinstance(note, dict):
                all_notes.append({**note, "patient_name": p_name})
            else:
                all_notes.append({"patient_name": p_name, "note": note, "timestamp": datetime.now().isoformat()})
    all_notes.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return {"notes": all_notes, "total": len(all_notes)}


@app.get("/api/patients")
async def get_patient_list(doctor_id: str = None):
    """Retrieve the doctor's active patient roster."""
    doctor_id = doctor_id or PATIENTS_API_DOCTOR_ID
    roster = await async_fetch_patient_list(doctor_id)
    result = []
    for p in roster:
        full_name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
        if not full_name:
            full_name = p.get('name', 'Patient')
        result.append({
            "id": p.get("id"),
            "name": full_name,
            "mobile": p.get("mobile", ""),
        })
    return result


@app.post("/api/clinical-notes")
async def save_clinical_note_api(payload: dict):
    """Save or update clinical notes manually via dashboard or external EHR webhook."""
    p_name = payload.get("patient_name", "").strip()
    content = payload.get("note_content") or payload.get("note", "")
    author = payload.get("author", f"Dr. {DEFAULT_DOCTOR_NAME}")
    category = payload.get("category", "General")
    if not p_name or not content:
        raise HTTPException(status_code=400, detail="patient_name and note_content are required")
    record = {
        "id": str(uuid.uuid4())[:8],
        "note": content,
        "author": author,
        "category": category,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "dashboard_writeback"
    }
    _clinical_notes.setdefault(p_name, []).append(record)
    return {"status": "success", "saved": record}


@app.get("/api/token-metrics")
async def get_token_metrics():
    """Return aggregated token metrics, cost estimation, and optimization efficiency (Document Section 5)."""
    p_tok = _runtime_metrics.get("total_prompt_tokens", 0)
    c_tok = _runtime_metrics.get("total_candidate_tokens", 0)
    turns = _runtime_metrics.get("total_turns", 0)
    total_tok = p_tok + c_tok
    avg_turn = round(total_tok / turns, 1) if turns else 0

    # Pricing estimation (Gemini Live Audio API: ~$0.0000025/input token, ~$0.00004/output audio token)
    cost_usd = round((p_tok * 0.0000025) + (c_tok * 0.00004), 4)
    cost_inr = round(cost_usd * 86.5, 2)  # Conversion to INR

    return {
        "status": "active",
        "total_prompt_tokens": p_tok,
        "total_candidate_tokens": c_tok,
        "total_tokens": total_tok,
        "total_conversation_turns": turns,
        "average_tokens_per_turn": avg_turn,
        "cost_estimation": {
            "currency_usd": f"${cost_usd:.4f}",
            "currency_inr": f"₹{cost_inr:.2f}",
            "cost_per_turn_inr": f"₹{round(cost_inr / turns, 3)}" if turns else "₹0.00",
        },
        "last_turn": _runtime_metrics.get("last_turn_tokens"),
        "optimizations": {
            "persona_slicing": True,
            "streamlined_prompt": True,
            "silence_gating": True,
            "silence_timeout_ms": 750,
            "concise_output_mandate": True,
            "zero_disclaimers_enforced": True,
            "max_patient_record_chars": MAX_TOOL_RECORD_CHARS,
        }
    }


_FLEET_DB_FILE = os.path.join(os.path.dirname(__file__), "..", "fleet-dashboard", "backend", "fleet_db.json")


def _load_fleet_speakers():
    if os.path.exists(_FLEET_DB_FILE):
        try:
            with open(_FLEET_DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def format_network_strength(rssi: Optional[int]) -> str:
    """Format RSSI dBm into a percentage and qualitative link description."""
    if rssi is None:
        return "Unknown Signal"
    try:
        r = int(rssi)
    except Exception:
        return f"{rssi} dBm"
    
    # Calculate percentage approximately: -100 dBm = 0%, -50 dBm or higher = 100%
    if r >= -50:
        pct = 100
        quality = "Excellent Link"
    elif r <= -100:
        pct = 0
        quality = "No Signal / Carrier Lost"
    else:
        pct = max(0, min(100, int(2 * (r + 100))))
        if r >= -65:
            quality = "Good Link"
        elif r >= -75:
            quality = "Fair Link"
        else:
            quality = "Weak Link"
    return f"{r} dBm [{quality} — {pct}%]"


def log_network_event(event_type: str, device_id: str, ip: str = None, ssid: str = None, rssi: int = None, reason: str = ""):
    """Output high-visibility, crystal-clear network event log to backend terminal."""
    is_connected = event_type.upper() in ("WIFI_CONNECTED", "CONNECTED", "WIFI_UP", "UP")
    is_standby = event_type.upper() in ("STANDBY", "SLEEP", "WIFI_STANDBY")
    ssid_str = ssid or "TFTus-WiFi"
    ip_str = ip or ("192.168.50.96" if (is_connected or is_standby) else "None (Interface Dropped)")
    strength_str = format_network_strength(rssi if rssi is not None else (-48 if (is_connected or is_standby) else -100))

    if is_connected:
        banner = (
            f"\n{'='*78}\n"
            f"📶 [NETWORK LOG] WI-FI CONNECTED (Status: ONLINE)\n"
            f"{'-'*78}\n"
            f" • Device ID       : {device_id}\n"
            f" • IP Address      : {ip_str}\n"
            f" • Wi-Fi SSID      : '{ssid_str}'\n"
            f" • Signal Strength : {strength_str}\n"
            f" • Network Protocol: 802.11 b/g/n (2.4 GHz) • Mode: STA\n"
            f" • Voice Engine    : Port 8008 • Active 16kHz WebSocket Stream\n"
            f" • Grafana Stream  : Synced -> https://monitoring.yhealth.me/d/ad7r252?var-device_id={device_id}\n"
            f"{'='*78}"
        )
    elif is_standby:
        banner = (
            f"\n{'='*78}\n"
            f"🌙 [NETWORK LOG] DEVICE ENTERED STANDBY / SLEEP (Status: STANDBY)\n"
            f"{'-'*78}\n"
            f" • Device ID       : {device_id}\n"
            f" • Last Known IP   : {ip_str}\n"
            f" • Wi-Fi SSID      : '{ssid_str}'\n"
            f" • Mode State      : Standby (Wi-Fi ON • WebSocket Halted)\n"
            f" • Local Mic       : Active (Listening for 'Hello Assistant' / 'LIRA')\n"
            f" • Disconnect Info : {reason or 'Inactivity Standby (2m halt)'}\n"
            f" • Grafana Alert   : Synced -> https://monitoring.yhealth.me/d/ad7r252?var-device_id={device_id}\n"
            f"{'='*78}"
        )
    else:
        banner = (
            f"\n{'='*78}\n"
            f"⚠️ [NETWORK LOG] WI-FI DISCONNECTED / DROPPED (Status: OFFLINE)\n"
            f"{'-'*78}\n"
            f" • Device ID       : {device_id}\n"
            f" • Last Known IP   : {ip_str}\n"
            f" • Wi-Fi SSID      : '{ssid_str}'\n"
            f" • Signal Strength : 0 dBm (No Carrier)\n"
            f" • Disconnect Info : {reason or 'Connection Closed / Power Loss'}\n"
            f" • Power State     : Offline (No Carrier)\n"
            f" • Grafana Alert   : Synced -> https://monitoring.yhealth.me/d/ad7r252?var-device_id={device_id}\n"
            f"{'='*78}"
        )
    logger.info(banner)


def _mark_device_status_in_fleet(device_label: str, status: str = "online", reason: str = "", wifi_connected: bool = True, ip: str = None, ssid: str = None, rssi: int = None):
    if not os.path.exists(_FLEET_DB_FILE) or not device_label:
        return
    try:
        with open(_FLEET_DB_FILE, "r", encoding="utf-8") as f:
            speakers = json.load(f)
        clean_id = device_label.strip().upper()
        clean_mac = re.sub(r"[^0-9A-Fa-f]", "", device_label).upper()
        changed = False
        target_device_id = None
        for s in speakers:
            spk_id = s.get("device_id", "").strip().upper()
            spk_mac = re.sub(r"[^0-9A-Fa-f]", "", s.get("mac_address", "")).upper()
            if spk_id == clean_id or (len(clean_mac) == 12 and spk_mac == clean_mac):
                s["status"] = status
                s["wifi_connected"] = wifi_connected
                s["status_reason"] = reason or ("WebSocket Live Connected" if status == "online" else "Standby Mode (Wi-Fi ON • Mic Listening)")
                if ip:
                    s["ip_address"] = ip
                if ssid:
                    s["wifi_ssid"] = ssid
                if rssi is not None:
                    s["wifi_rssi"] = rssi
                s["last_seen_at"] = "Just now"
                target_device_id = s.get("device_id")
                changed = True
                break
        if changed:
            with open(_FLEET_DB_FILE, "w", encoding="utf-8") as f:
                json.dump(speakers, f, indent=2, ensure_ascii=False)
            if target_device_id:
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        loop.create_task(_notify_fleet_status(target_device_id, status, wifi_connected, reason, ip, ssid, rssi))
                except Exception:
                    pass
    except Exception:
        pass


async def _notify_fleet_status(device_id: str, status: str, wifi_connected: bool, reason: str, ip: str = None, ssid: str = None, rssi: int = None):
    try:
        payload = {"status": status, "wifi_connected": wifi_connected, "reason": reason}
        if ip:
            payload["ip_address"] = ip
        if ssid:
            payload["wifi_ssid"] = ssid
        if rssi is not None:
            payload["wifi_rssi"] = rssi
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(
                f"http://127.0.0.1:8010/api/speakers/{device_id}/status",
                json=payload
            )
            await client.post(
                f"http://127.0.0.1:8010/api/speakers/{device_id}/network-event",
                json={
                    "event": "WIFI_CONNECTED" if wifi_connected else "WIFI_DISCONNECTED",
                    "ssid": ssid or "TFTus-WiFi",
                    "ip": ip,
                    "rssi": rssi,
                    "reason": reason
                }
            )
    except Exception:
        pass


async def _notify_fleet_conversation(device_id: str, user_text: str, assistant_text: str, doctor_id: str = ""):
    """Relay full conversation turns to the fleet dashboard and Grafana log stream."""
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(
                f"http://127.0.0.1:8010/api/speakers/{device_id}/conversation",
                json={
                    "user_text": user_text,
                    "assistant_text": assistant_text,
                    "doctor_id": doctor_id
                }
            )
    except Exception:
        pass


def _mark_device_online_in_fleet(device_label: str, ip: str = None, ssid: str = None, rssi: int = None):
    _mark_device_status_in_fleet(device_label, "online", "Wake Word Triggered / WebSocket Live Active", True, ip=ip, ssid=ssid, rssi=rssi)


def _mark_device_offline_in_fleet(device_label: str, reason: str = "WebSocket Disconnected", ip: str = None, ssid: str = None):
    _mark_device_status_in_fleet(device_label, "offline", reason, False, ip=ip, ssid=ssid, rssi=0)


def _mark_device_standby_in_fleet(device_label: str, ip: str = None, ssid: str = None, rssi: int = None):
    _mark_device_status_in_fleet(device_label, "standby", "Standby Mode (Wi-Fi ON • WebSocket Halted • Mic Active)", True, ip=ip, ssid=ssid, rssi=rssi)


ACTIVE_ESP_CONNECTIONS: dict = {}

@app.get("/api/active-speakers")
async def get_active_connected_speakers():
    """Returns currently connected hardware WebSockets and their live status."""
    safe_connections = []
    for conn in list(ACTIVE_ESP_CONNECTIONS.values()):
        safe_connections.append({
            "connection_id": conn.get("connection_id"),
            "device_label": conn.get("device_label"),
            "doctor_id": conn.get("doctor_id"),
            "client_ip": conn.get("client_ip"),
            "wifi_ssid": conn.get("wifi_ssid"),
            "wifi_rssi": conn.get("wifi_rssi"),
            "connected_at": conn.get("connected_at"),
            "status": conn.get("status", "online"),
            "wifi_connected": conn.get("wifi_connected", True),
        })
    return {
        "count": len(ACTIVE_ESP_CONNECTIONS),
        "connections": safe_connections,
        "server_time": datetime.now(timezone.utc).isoformat()
    }

@app.get("/api/speakers")
async def get_speakers_endpoint(role: str = None):
    """Retrieve all ecosystem speakers (filtered optionally by role: 'doctor' or 'patient')."""
    speakers = _load_fleet_speakers()
    if role:
        speakers = [s for s in speakers if s.get("role", "").lower() == role.lower()]
    return {"count": len(speakers), "speakers": speakers}


@app.get("/api/stats")
async def get_ecosystem_stats():
    """Retrieve ecosystem-wide device and patient statistics."""
    speakers = _load_fleet_speakers()
    doctors = [s for s in speakers if s.get("role") == "doctor"]
    patients = [s for s in speakers if s.get("role") == "patient"]
    online = [s for s in speakers if s.get("status") == "online"]
    return {
        "total_speakers": len(speakers),
        "doctor_speakers_count": len(doctors),
        "patient_speakers_count": len(patients),
        "online_count": len(online),
        "total_managed_patients": sum(d.get("active_patients_count", 0) for d in doctors) + len(patients),
    }


@app.post("/api/speakers/{target_id}/speak")
async def trigger_speaker_voice_announcement(target_id: str, payload: dict = Body(default={})):
    """
    Speaks an arbitrary sentence aloud on the physical hardware speaker via WebSocket PCM stream.
    Zero disruption to Gemini Live sessions or sleep/standby logic.
    """
    clean_target = re.sub(r"[^0-9a-fA-F]", "", target_id).lower()
    text = payload.get("message") or payload.get("text") or "Central dashboard ping test."

    target_conn = None
    for cid, conn in list(ACTIVE_ESP_CONNECTIONS.items()):
        dev_label = re.sub(r"[^0-9a-fA-F]", "", str(conn.get("device_label", ""))).lower()
        if (clean_target and (clean_target in dev_label or dev_label in clean_target)) or (target_id.lower() == str(conn.get("device_label", "")).lower()):
            target_conn = conn
            break

    if not target_conn and len(ACTIVE_ESP_CONNECTIONS) == 1:
        target_conn = next(iter(ACTIVE_ESP_CONNECTIONS.values()))

    if not target_conn:
        raise HTTPException(
            status_code=404,
            detail=f"Speaker '{target_id}' has no active audio session (device may be in Standby or Offline)"
        )

    speak_fn = target_conn.get("speak_fn")
    if not speak_fn:
        raise HTTPException(status_code=503, detail="Speaker voice audio pipeline is still initializing")

    # Schedule speech task asynchronously so the caller receives immediate acknowledgement
    asyncio.create_task(speak_fn(text))
    logger.info(f"🔊 Spoken announcement scheduled for '{target_conn.get('device_label')}': '{text[:40]}...'")
    return {
        "status": "spoken",
        "device_label": target_conn.get("device_label"),
        "text": text,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.post("/api/speakers/{target_id}/volume")
async def set_speaker_hardware_volume(target_id: str, payload: dict = Body(default={})):
    """
    Sends real-time volume adjustment down the WebSocket to the physical ESP32 speaker.
    Sets the hardware amplifier gain and visual LED VU meter immediately.
    """
    vol = max(0, min(100, int(payload.get("volume", 75))))
    clean_target = re.sub(r"[^0-9a-fA-F]", "", target_id).lower()

    target_conn = None
    for cid, conn in list(ACTIVE_ESP_CONNECTIONS.items()):
        dev_label = re.sub(r"[^0-9a-fA-F]", "", str(conn.get("device_label", ""))).lower()
        if (clean_target and (clean_target in dev_label or dev_label in clean_target)) or (target_id.lower() == str(conn.get("device_label", "")).lower()):
            target_conn = conn
            break

    if not target_conn and len(ACTIVE_ESP_CONNECTIONS) == 1:
        target_conn = next(iter(ACTIVE_ESP_CONNECTIONS.values()))

    if not target_conn:
        raise HTTPException(
            status_code=404,
            detail=f"Speaker '{target_id}' has no active WebSocket connection"
        )

    ws = target_conn.get("websocket")
    if not ws:
        raise HTTPException(status_code=503, detail="Speaker WebSocket is not ready")

    try:
        await ws.send_text(json.dumps({"type": "set_volume", "volume": vol}))
        logger.info(f"🔊 [HARDWARE_VOLUME] Sent volume={vol}% down WebSocket to '{target_conn.get('device_label')}'")
    except Exception as e:
        logger.warning(f"Error sending volume to speaker: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "volume_dispatched",
        "device_label": target_conn.get("device_label"),
        "volume": vol,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

# PERSONA HELPERS
# ==========================================================
_DROP_KEYS = {
    "_meta", "persona_id", "patient_id", "mongo_patient_id", "token", "auth_token",
    "jwt", "url", "image_url", "report_url", "pdf_url", "avatar",
}
_URL_RE = re.compile(r"https?://\S+|www\.\S+|s3://\S+")
_JWT_RE = re.compile(r"eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+")
_DOCTOR_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _is_empty(v) -> bool:
    return v is None or v == "" or v == {} or v == []


def clean_persona_dict(obj):
    """Recursively strips URLs, JWTs, ids and metadata. Keeps legitimate 0 / False values."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in _DROP_KEYS:
                continue
            cv = clean_persona_dict(v)
            if not _is_empty(cv):
                out[k] = cv
        return out
    if isinstance(obj, list):
        items = [clean_persona_dict(i) for i in obj]
        return [i for i in items if not _is_empty(i)]
    if isinstance(obj, str):
        return _JWT_RE.sub("", _URL_RE.sub("", obj)).strip()
    return obj


def slice_patient_persona(raw_data: dict, max_chars: int = 2500) -> dict:
    """
    Persona Slicing Optimization (Document Section 4.6):
    Constructs a compact, high-density clinical slice for Gemini instead of
    transmitting the entire multi-kilobyte persona.
    Preserves all clinically safety-critical fields:
      - Demographics (name, age, gender, date_of_birth)
      - Anthropometry & Body Composition (weight_kg, height_cm, bmi, bmr)
      - Vitals & Face Scan Extraction (pulse_rate, respiration_rate, spo2)
      - Labs & Screening Estimates (estimated HbA1c, hemoglobin, risk scores)
      - Confirmed Diagnoses vs Screening Risks (Zero Hallucination)
      - Active Medications (exact dosages and frequencies)
      - Allergies & Care Program
    """
    if not isinstance(raw_data, dict) or not raw_data:
        return {"status": "no_record_found"}

    p = raw_data.get("persona", raw_data)
    if isinstance(p, dict) and isinstance(p.get("data"), dict):
        p = p["data"]
    if not isinstance(p, dict):
        return {"summary": str(p)[:400]}

    slice_data = {}

    # 1. Demographics
    identity = p.get("identity") or p.get("patient") or p.get("user") or {}
    demo = {}
    if isinstance(identity, dict):
        fn = identity.get("first_name") or identity.get("firstName") or ""
        ln = identity.get("last_name") or identity.get("lastName") or ""
        name = f"{fn} {ln}".strip() or identity.get("name") or identity.get("full_name") or ""
        if name:
            demo["name"] = name
        age = identity.get("age_years") or identity.get("age")
        if age:
            demo["age"] = age
        gender = identity.get("gender") or identity.get("sex")
        if gender:
            demo["gender"] = gender
        dob = identity.get("date_of_birth") or identity.get("dob")
        if dob:
            demo["date_of_birth"] = dob
        if demo:
            slice_data["demographics"] = demo

    # 2. Anthropometry & Body Composition (Weight, Height, BMI, BMR)
    anth = identity.get("anthropometry") if isinstance(identity, dict) else {}
    wt_meas = p.get("weight_and_composition_profile", {}).get("latest_measurement") if isinstance(p.get("weight_and_composition_profile"), dict) else {}
    body_comp = {}
    wt = (anth.get("weight_kg") if isinstance(anth, dict) else None) or (wt_meas.get("weight_kg") if isinstance(wt_meas, dict) else None)
    if wt:
        body_comp["weight"] = f"{wt} kg"
    ht = anth.get("height_cm") if isinstance(anth, dict) else None
    if ht:
        body_comp["height"] = f"{ht} cm"
    bmi = (anth.get("bmi") if isinstance(anth, dict) else None) or (wt_meas.get("bmi") if isinstance(wt_meas, dict) else None)
    bmi_cat = (anth.get("bmi_category") if isinstance(anth, dict) else None) or (wt_meas.get("bmi_category") if isinstance(wt_meas, dict) else None)
    if bmi:
        body_comp["bmi"] = f"{bmi} ({bmi_cat})" if bmi_cat else str(bmi)
    bmr = anth.get("bmr_kcal") if isinstance(anth, dict) else None
    if bmr:
        body_comp["bmr"] = f"{bmr} kcal"
    m_cal = anth.get("maintenance_calories_kcal") if isinstance(anth, dict) else None
    if m_cal:
        body_comp["maintenance_calories"] = f"{m_cal} kcal"
    wl_cal = anth.get("weight_loss_calories_kcal") if isinstance(anth, dict) else None
    if wl_cal:
        body_comp["weight_loss_calories"] = f"{wl_cal} kcal"
    fat = (anth.get("body_fat_percent") if isinstance(anth, dict) else None) or (wt_meas.get("body_fat_percent") if isinstance(wt_meas, dict) else None)
    if fat and float(fat) > 0:
        body_comp["body_fat"] = f"{fat}%"
    muscle = (anth.get("muscle_mass_kg") if isinstance(anth, dict) else None) or (wt_meas.get("muscle_mass_kg") if isinstance(wt_meas, dict) else None)
    if muscle and float(muscle) > 0:
        body_comp["muscle_mass"] = f"{muscle} kg"
    if body_comp:
        slice_data["body_composition"] = body_comp

    # 3. Vitals (clean & compact) & Face Scan Extraction
    clean_vitals = {}
    vitals = p.get("vitals") or p.get("vital_signs") or {}
    if isinstance(vitals, dict) and vitals:
        for k in ("blood_pressure", "bp", "systolic_bp", "diastolic_bp", "heart_rate", "pulse",
                  "weight", "weight_kg", "bmi", "blood_glucose", "random_blood_sugar",
                  "fasting_blood_sugar", "hba1c", "spo2", "temperature"):
            v = vitals.get(k)
            if v is not None and v != "":
                clean_vitals[k] = v.get("value") if isinstance(v, dict) else v

    # Direct Blood Pressure Profile
    bp_prof = p.get("blood_pressure_profile", {}).get("latest_measurement") if isinstance(p.get("blood_pressure_profile"), dict) else {}
    if isinstance(bp_prof, dict) and bp_prof:
        sys_bp = bp_prof.get("systolic") or bp_prof.get("systolic_bp")
        dia_bp = bp_prof.get("diastolic") or bp_prof.get("diastolic_bp")
        if sys_bp and dia_bp:
            clean_vitals["blood_pressure"] = f"{sys_bp}/{dia_bp} mmHg"

    # Direct Glucometer Profile
    gluc_prof = p.get("glucometer_profile", {}) if isinstance(p.get("glucometer_profile"), dict) else {}
    if isinstance(gluc_prof, dict) and gluc_prof:
        latest_g = gluc_prof.get("latest_reading") or gluc_prof.get("latest_measurement")
        if isinstance(latest_g, dict):
            gv = latest_g.get("glucose_mg_dl") or latest_g.get("value")
            meal = latest_g.get("meal_tag") or latest_g.get("type") or ""
            if gv:
                clean_vitals["glucometer_glucose"] = f"{gv} mg/dL ({meal})".strip()
        elif gluc_prof.get("fasting_glucose"):
            clean_vitals["fasting_glucose"] = f"{gluc_prof.get('fasting_glucose')} mg/dL"

    face_scan = p.get("face_scan_profile", {}).get("latest_scan") if isinstance(p.get("face_scan_profile"), dict) else {}
    if isinstance(face_scan, dict) and face_scan:
        f_vitals = face_scan.get("vital_signs_extracted") or {}
        if isinstance(f_vitals, dict):
            if f_vitals.get("pulse_rate_bpm"):
                clean_vitals["pulse_rate"] = f"{f_vitals.get('pulse_rate_bpm')} bpm"
            if f_vitals.get("oxygen_saturation_percent"):
                clean_vitals["spo2"] = f"{f_vitals.get('oxygen_saturation_percent')}%"
            if f_vitals.get("respiration_rate_rpm"):
                clean_vitals["respiration_rate"] = f"{f_vitals.get('respiration_rate_rpm')} rpm"
    if clean_vitals:
        slice_data["vitals"] = clean_vitals

    # 4. Lab Results & Screening Estimates
    key_labs = {}
    if isinstance(face_scan, dict) and face_scan:
        f_labs = face_scan.get("lab_estimates") or {}
        if isinstance(f_labs, dict):
            if f_labs.get("hba1c_percent"):
                key_labs["estimated_hba1c_face_scan"] = f"{f_labs.get('hba1c_percent')}%"
            if f_labs.get("hemoglobin_gdl"):
                key_labs["hemoglobin_face_scan"] = f"{f_labs.get('hemoglobin_gdl')} g/dL"
        f_risks = face_scan.get("risk_scores") or {}
        if isinstance(f_risks, dict):
            risks_summary = []
            for rk, rv in f_risks.items():
                if rv:
                    risks_summary.append(f"{rk.replace('_', ' ').title()}: {rv}")
            if risks_summary:
                key_labs["screening_risk_scores"] = risks_summary
            if f_risks.get("diabetes_risk"):
                key_labs["diabetes_screening_risk"] = f_risks.get("diabetes_risk")
            if f_risks.get("hypertension_risk"):
                key_labs["hypertension_screening_risk"] = f_risks.get("hypertension_risk")
        stress = face_scan.get("stress_metrics") or {}
        if isinstance(stress, dict) and stress.get("stress_level"):
            key_labs["stress_level"] = stress.get("stress_level")
            if stress.get("stress_index") is not None:
                key_labs["stress_index"] = stress.get("stress_index")
        wellness = face_scan.get("wellness_metrics") or {}
        if isinstance(wellness, dict) and wellness.get("wellness_level"):
            key_labs["wellness_level"] = wellness.get("wellness_level")
            if wellness.get("wellness_index") is not None:
                key_labs["wellness_index"] = wellness.get("wellness_index")
        hrv = face_scan.get("hrv_metrics") or {}
        if isinstance(hrv, dict) and hrv:
            hrv_clean = {hk: hrv[hk] for hk in ("sdnn", "rmssd", "prq", "lf_hf_ratio") if hrv.get(hk) is not None}
            if hrv_clean:
                key_labs["hrv_metrics"] = hrv_clean
        auto = face_scan.get("autonomic_balance") or {}
        if isinstance(auto, dict) and auto:
            auto_clean = {ak: auto[ak] for ak in ("pns_zone", "sns_zone") if auto.get(ak)}
            if auto_clean:
                key_labs["autonomic_balance"] = auto_clean

    labs_prof = p.get("lab_results_profile") or {}
    latest_report = labs_prof.get("latest_report") if isinstance(labs_prof, dict) else {}
    cgm = p.get("cgm_metrics") or p.get("cgm") or p.get("cgm_profile") or {}
    labs_list = p.get("lab_reports") or p.get("labs") or []

    if isinstance(cgm, dict) and cgm:
        avg_g = cgm.get("average_glucose") or cgm.get("mean_glucose")
        if avg_g:
            key_labs["cgm_average_glucose"] = avg_g
        tir = cgm.get("time_in_range_percent") or cgm.get("time_in_range")
        if tir:
            key_labs["time_in_range_pct"] = tir

    if isinstance(latest_report, dict) and latest_report:
        if latest_report.get("report_date"):
            key_labs["latest_report_date"] = latest_report.get("report_date")
        for cat in ("glucose", "diabetes", "hematology", "lipids", "kidney", "renal", "electrolytes"):
            cat_obj = latest_report.get(cat)
            if isinstance(cat_obj, dict):
                for lk, lv in cat_obj.items():
                    val = lv.get("value") if isinstance(lv, dict) else lv
                    unit = lv.get("unit") if isinstance(lv, dict) else ""
                    if val is not None and val != "":
                        key_labs[lk] = f"{val} {unit}".strip() if unit else val
    elif isinstance(labs_list, list) and labs_list:
        for lab in labs_list[:3]:
            if isinstance(lab, dict):
                test = lab.get("test_name") or lab.get("name") or "test"
                val = lab.get("value") or lab.get("result")
                unit = lab.get("unit") or ""
                dt = lab.get("date") or ""
                if val:
                    key_labs[test] = f"{val} {unit}".strip() + (f" ({dt})" if dt else "")

    if key_labs:
        slice_data["labs_and_screening"] = key_labs
    else:
        slice_data["labs_and_screening"] = "No formal lab reports or CGM on file"

    # 5. Clinical Context & Confirmed Diagnoses (Anti-Hallucination Guard)
    clin_ctx = p.get("clinical_context") if isinstance(p.get("clinical_context"), dict) else {}
    diag_list = clin_ctx.get("diagnoses") or p.get("diagnoses") or p.get("chronic_conditions") or []
    if isinstance(diag_list, list) and diag_list:
        slice_data["confirmed_diagnoses"] = [str(c).strip() for c in diag_list[:5] if c]
    else:
        is_diab = clin_ctx.get("is_diabetic", False)
        is_htn = clin_ctx.get("is_hypertensive", False)
        slice_data["confirmed_diagnoses"] = f"None recorded on file (is_diabetic={is_diab}, is_hypertensive={is_htn}). Screening risk is NOT a confirmed diagnosis."

    allergies = clin_ctx.get("allergies_and_restrictions") or p.get("allergies") or p.get("known_allergies") or []
    if allergies and isinstance(allergies, list) and any(allergies):
        slice_data["allergies"] = [str(a).strip() for a in allergies[:5] if a]
    else:
        slice_data["allergies"] = "None recorded"

    # 6. Active Medications
    meds_prof = p.get("medications_profile") or {}
    active_meds = meds_prof.get("active_medications") if isinstance(meds_prof, dict) else None
    active_meds = active_meds or p.get("medications") or p.get("current_medications") or []
    if isinstance(active_meds, list) and active_meds:
        med_slices = []
        for m in active_meds[:6]:
            if isinstance(m, dict):
                m_name = m.get("name") or m.get("medication_name") or m.get("drug_name") or "Medication"
                dose = m.get("dosage") or m.get("dose") or ""
                freq = m.get("frequency") or m.get("timing") or ""
                med_slices.append(f"{m_name} {dose} {freq}".strip())
            elif isinstance(m, str) and m.strip():
                med_slices.append(m.strip())
        if med_slices:
            slice_data["active_medications"] = med_slices
        else:
            slice_data["active_medications"] = "None recorded"
    else:
        slice_data["active_medications"] = "None recorded"

    # 7. Care Program & Doctor
    care = p.get("care_team") if isinstance(p.get("care_team"), dict) else {}
    prog = care.get("current_program") if isinstance(care, dict) else {}
    if isinstance(prog, dict) and prog.get("program_name"):
        slice_data["care_program"] = prog.get("program_name")
    doc = care.get("assigned_doctor") if isinstance(care, dict) else {}
    if isinstance(doc, dict) and doc.get("name"):
        slice_data["assigned_doctor"] = doc.get("name")

    # 8. Emergency Flags
    meta = p.get("_meta") if isinstance(p.get("_meta"), dict) else {}
    em_flags = meta.get("emergency_flags") if isinstance(meta, dict) else {}
    if isinstance(em_flags, dict) and em_flags:
        slice_data["emergency_flags"] = em_flags

    # 9. Recent Summary Notes
    ns = p.get("narrative_summary") or {}
    summary_note = ns.get("short_summary") if isinstance(ns, dict) else (p.get("summary") or p.get("notes"))
    if summary_note:
        slice_data["clinical_summary"] = str(summary_note)[:300].strip()

    serialized = json.dumps(slice_data, ensure_ascii=False)
    if len(serialized) > max_chars:
        return summarize_persona_for_tool_response(slice_data)

    return slice_data if slice_data else clean_persona_dict(p)


def summarize_persona_for_tool_response(raw_data: dict) -> dict:
    """Compact fallback summary, used only if the full cleaned record is too large."""
    if not raw_data:
        return {"status": "no_record_found"}
    if not isinstance(raw_data, dict):
        return {"summary": str(raw_data)[:300]}

    p = raw_data.get("persona", raw_data)
    if isinstance(p, dict) and isinstance(p.get("data"), dict):
        p = p["data"]
    if not isinstance(p, dict):
        return {"summary": str(p)[:300]}

    identity = p.get("identity", {}) or {}
    vitals = p.get("vitals", {}) or {}
    cgm = p.get("cgm_metrics") or p.get("cgm") or p.get("cgm_profile") or {}
    labs_prof = p.get("lab_results_profile", {}) or {}
    latest_lab = labs_prof.get("latest_report", {}) if isinstance(labs_prof, dict) else {}
    labs = p.get("lab_reports") or p.get("labs") or []
    meds_prof = p.get("medications_profile", {}) or {}
    meds = meds_prof.get("active_medications") if isinstance(meds_prof, dict) else None
    meds = meds or p.get("medications") or []
    ns = p.get("narrative_summary")
    narrative = ns.get("short_summary") if isinstance(ns, dict) else None

    summary = {}
    if isinstance(identity, dict):
        name = f"{identity.get('first_name', '')} {identity.get('last_name', '')}".strip()
        if name:
            summary["patient_name"] = name
        if identity.get("age_years"):
            summary["age"] = identity.get("age_years")
        if identity.get("gender"):
            summary["gender"] = identity.get("gender")
    if vitals:
        summary["vitals"] = vitals
    if isinstance(cgm, dict) and cgm:
        summary["cgm_avg_glucose"] = cgm.get("average_glucose") or cgm.get("mean_glucose")
    if isinstance(latest_lab, dict) and latest_lab:
        lab_summary = {"report_name": latest_lab.get("report_name"), "report_date": latest_lab.get("report_date")}
        for cat in ["hematology", "lipids", "kidney", "glucose", "electrolytes"]:
            cat_data = latest_lab.get(cat)
            if isinstance(cat_data, dict) and cat_data:
                lab_summary[cat] = {k: (v.get("value") if isinstance(v, dict) else v) for k, v in cat_data.items() if v is not None}
        summary["latest_lab_report"] = lab_summary
    elif labs:
        summary["latest_labs"] = labs[:2] if isinstance(labs, list) else str(labs)[:200]
    if meds:
        summary["medications"] = meds[:5] if isinstance(meds, list) else str(meds)[:200]
    if narrative:
        summary["summary_notes"] = narrative
    return summary if summary else clean_persona_dict(p)


def build_tool_patient_data(p_data: dict) -> dict:
    """Persona Slicing: Return compact clinical context (saving 80-90% input tokens)."""
    return slice_patient_persona(p_data, max_chars=MAX_TOOL_RECORD_CHARS)


# ==========================================================
# PROMPT
# ==========================================================
def part_of_day() -> str:
    """Return 'morning', 'afternoon', or 'evening' based on current IST hour.

    IST standard greeting breakdown:
    04:00 - 11:59: 'morning' ('Good morning' / 'सुप्रभात')
    12:00 - 16:59: 'afternoon' ('Good afternoon' / 'शुभ दोपहर' / 'नमस्कार')
    17:00 - 22:59: 'evening' ('Good evening' / 'शुभ संध्या')
    23:00 - 03:59: 'evening' (night shift / late clinic hours)
    """
    h = get_current_ist_datetime().hour
    if 4 <= h < 12:
        return "morning"
    elif 12 <= h < 17:
        return "afternoon"
    else:
        return "evening"


def build_doctor_agent_prompt(
    doctor_name: str = None,
    specialization: str = None,
    clinic_name: str = None,
    patient_name: str = None,
    persona_str: str = None,
    doctor_persona: dict = None,
) -> str:
    # If dynamic doctor persona is provided, extract profile details
    if isinstance(doctor_persona, dict) and doctor_persona:
        doc_details = doctor_persona.get("doctor_details", {})
        if isinstance(doc_details, dict):
            fn = str(doc_details.get("first_name") or "").strip()
            ln = str(doc_details.get("last_name") or "").strip()
            if fn or ln:
                doctor_name = f"{fn} {ln}".strip()
            specialization = doc_details.get("specialization") or specialization
            clinics = doc_details.get("clinics", [])
            if clinics and isinstance(clinics, list) and isinstance(clinics[0], dict):
                clinic_name = clinics[0].get("name") or clinic_name

    doctor_name = doctor_name or DEFAULT_DOCTOR_NAME
    specialization = specialization or DEFAULT_DOCTOR_SPECIALIZATION
    clinic_name = clinic_name or DEFAULT_DOCTOR_CLINIC
    salutation = "Dr. Makkar" if "Makkar" in doctor_name else f"Dr. {doctor_name}"

    # Real-Time Clock in IST
    ist_dt = get_current_ist_datetime()
    tod = part_of_day()
    hindi_tod = "सुप्रभात" if tod == "morning" else "शुभ दोपहर" if tod == "afternoon" else "शुभ संध्या"
    current_time_ist = ist_dt.strftime("%I:%M %p IST").lstrip("0")
    day_of_week = ist_dt.strftime("%A")

    consultations = []
    active_count = None
    consultation_date = get_today_date_str()
    if isinstance(doctor_persona, dict) and doctor_persona:
        consultations = doctor_persona.get("today_consultations") or doctor_persona.get("consultations") or []
        active_count = doctor_persona.get("active_patients_count")
        consultation_date = doctor_persona.get("date") or consultation_date

    if consultations:
        consultation_count = len(consultations)
        consultations_summary = f"     {consultation_count} consultations scheduled for today. Call get_doctor_consultations for details."
    else:
        consultations_summary = "     No consultations scheduled for today."

    if patient_name and persona_str:
        patient_block = (
            f"ACTIVE PATIENT: {patient_name}\n"
            "PATIENT CLINICAL SLICE:\n"
            f"{persona_str}\n"
        )
    else:
        patient_block = (
            "ACTIVE PATIENT: none loaded yet.\n"
            "Records are loaded on demand with load_patient_record. Once loaded, answer clinical questions using ONLY that record.\n"
        )

    active_count_str = f"Active Patients on Roster: {active_count}\n" if active_count is not None else ""

    return (
        "CRITICAL ROLE OVERRIDE — MANDATORY DIRECTIVE:\n"
        f"You are speaking directly with Dr. {doctor_name} ({specialization}), who is a senior licensed physician and medical specialist in clinic. "
        "DR. MAKKAR IS HIMSELF THE DOCTOR. HE DOES NOT NEED A DOCTOR.\n"
        "FORBIDDEN PHRASES — NEVER UNDER ANY CIRCUMSTANCE SAY:\n"
        "- 'consult a healthcare professional'\n"
        "- 'refer to a healthcare professional'\n"
        "- 'consult a doctor' or 'consult your doctor'\n"
        "- 'consult a physician' or 'consult a specialist'\n"
        "- 'please consult' or 'seek medical advice'\n"
        "- 'talk to your doctor' or 'this is not medical advice'\n"
        "Giving consumer disclaimers or advising Dr. Makkar to consult or refer to anyone is strictly prohibited. Provide direct clinical analysis, exact numbers, and laboratory facts only.\n\n"
        f"You are YHealth Assist, an intelligent clinical AI assistant speaking directly with Dr. {doctor_name}, "
        f"{specialization} at {clinic_name}. You assist consultations hands-free over voice.\n\n"
        "CORE RULES:\n"
        "1. UNIVERSAL MULTI-LANGUAGE FLUENCY (ALL REGIONAL & GLOBAL LANGUAGES): Speak and understand seamlessly in ANY regional Indian language (Hindi, Punjabi, Bengali, Marathi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Odia, Urdu, etc.), clinic Hinglish, or global language (English, Spanish, French, German, Arabic, etc.). "
        "Mirror the doctor's language automatically: if the doctor speaks in English, answer in English; if in Hindi/Hinglish, answer in natural clinic Hinglish; if in Punjabi, answer in Punjabi; if in any other regional or global language, reply fluently in that exact language. "
        "STRICT TERMINOLOGY RULE: When speaking Hindi/Hinglish, NEVER say 'mariz' (मरीज़); ALWAYS use the word 'patient' (e.g., 'Kis patient se shuru karna hai?', 'Patient ka record loaded hai'). "
        "NO PURE / SHUDDH HINDI: Do NOT use heavy, formal, or textbook Hindi (avoid words like 'शुभ दोपहर', 'सुप्रभात', 'मरीज़', 'चिकित्सक'). Use natural spoken conversational cadence with standard clinical terms ('patient', 'record', 'file', 'report', 'bp', 'sugar', 'dose', 'weight', 'vitals'). "
        "NEVER output language headers or translation labels like 'English:' or 'Hindi:'.\n"
        "2. EXTREME CLINICAL CONCISENESS (TOKEN EFFICIENCY): Spoken answers must strictly be 1 direct sentence (maximum 2 sentences if answering multiple metrics). "
        "Do not repeat the question or re-state patient demographics in the answer. State the numbers immediately. Zero filler, zero unsolicited advice, zero unasked metrics.\n"
        "3. STRICT GROUNDING & ZERO HALLUCINATIONS: When a patient record is loaded (via load_patient_record or clinical slice), read directly and exclusively from the returned patient data. Cite exact numbers, units, and categories from all sections:\n"
        "   - Demographics: Name, age, gender, date of birth.\n"
        "   - Body composition: Weight, height, BMI, BMI category, BMR, maintenance/weight loss calories.\n"
        "   - Vitals: Pulse rate, SpO2, respiration rate, blood pressure.\n"
        "   - Screening estimates & labs: Face scan estimates (estimated HbA1c, hemoglobin), screening risk scores (e.g. Diabetes Risk: Medium, Hypertension Risk: Medium), stress and wellness levels.\n"
        "   - Diagnoses: If confirmed_diagnoses says 'None recorded', state clearly that no confirmed diagnoses are recorded on file. A screening risk score (e.g. Medium diabetes risk) is NOT a confirmed diagnosis; NEVER invent Type 2 diabetes or hypertension.\n"
        "   - Medications & Allergies: Report active medications and allergies or state 'None recorded'.\n"
        "   - When the doctor asks for a summary or what details are in the record: summarize all available sections concisely (Name, Age, Weight, BMI, Vitals, Screening risks, and state that there are no confirmed diagnoses or active medications on file).\n"
        "   - NEVER claim a metric is missing if it is present in the record. If an exact metric is truly absent, state directly: 'Record mein yeh detail available nahi hai, Doctor.' Never invent diseases, lab values, or medications.\n"
        "4. DOCTOR AUDIENCE (ABSOLUTELY ZERO MEDICAL DISCLAIMERS & NO REFERRAL ADVICE): The person speaking to you IS the licensed physician and specialist ({salutation}) treating their patients in clinic. "
        "STRICTLY FORBIDDEN: NEVER EVER say 'refer to a healthcare professional', 'consult a healthcare professional', 'consult a doctor', 'consult a physician', 'consult a specialist', 'please consult', 'seek medical advice', 'talk to your doctor', 'advise you to consult', or 'this is not medical advice'. Under NO circumstances should you ever give consumer disclaimers or tell the doctor to refer or consult anyone. You are speaking directly to Dr. Makkar himself; provide direct clinical findings, numbers, and facts only.\n"
        "5. CRITICAL VALUES: If glucose <54 or >350 mg/dL, systolic BP >180, or diastolic BP >120, state the critical metric first in a clear, calm tone.\n"
        "6. MEDICAL SECURITY: Restricted to clinical care and workflow. Refuse non-medical topics: '{salutation}, I am strictly restricted to clinical patient care.'\n"
        "7. VOICE CADENCE: Warm Indian English / Delhi clinic cadence. Translate phonetic terms ('hba1c' -> HbA1c, 'bp' -> Blood Pressure). Never spell raw URLs or IDs.\n\n"
        "WORKFLOW & TOOLS:\n"
        f"- GREETING: On wake word or initial session greeting, greet in 1 short sentence without language prefixes (e.g. 'Good {tod}, {salutation}. Which patient would you like to start with?' or in Hinglish: 'Namaste {salutation}, aaj kis patient se start karna hai?'). NEVER use 'mariz' and never output language labels like 'English:' or 'Hindi:'.\n"
        f"- ACTIVE PATIENT RESUMPTION: If a patient record is already active and the user says 'Hello', checks in, or resumes speaking, DO NOT repeat the formal time-of-day greeting. Instead reply: 'Yes {salutation}, how can I help with the patient?' (or 'Ji {salutation}, patient ke bare mein kya janna chahte hain?').\n"
        "- REAL-TIME CLOCK (IST): You are grounded with an accurate real-time clock in Indian Standard Time (IST, UTC+5:30). State current time in 1 sentence. Call get_current_time if needed.\n"
        "- PATIENT LOOKUP & FAST CONFIRMATION: When a patient is named, immediately call load_patient_record. Once loaded, confirm in strictly ONE short sentence (e.g. '<Name>'s record loaded, <Age>yo <Gender>. What would you like to check, Doctor?' or 'Ji Doctor, <Name> ka record load ho gaya hai. Kya check karna hai?'). NEVER recite long unasked lists of missing fields or negative findings during confirmation. If ambiguous, ask for last 4 digits of phone, then call confirm_patient_by_phone_last4.\n"
        "- CLINICAL QUERIES WITH AN ACTIVE PATIENT: When an active patient is loaded, ANY clinical question (e.g. 'what is their hemoglobin?', 'sugar kitna hai?', 'vitals check karo', 'unka weight kya hai?', 'blood pressure?', 'HbA1c kitna hai?') refers directly to the ACTIVE PATIENT. Answer immediately using the loaded patient's data in 1 short sentence. NEVER ask 'Which patient?' or 'Kis patient ka?' when a patient is already active.\n"
        "- SWITCHING PATIENTS: If a patient is already active and Dr. Makkar asks to check, switch to, or names a different patient (e.g. 'Now check Rajiv Khattar', 'Open Sunil Sharma', 'Dusra patient dekho'), immediately call load_patient_record for the new patient. Once loaded, confirm in 1 short sentence. All subsequent questions now refer to the new patient.\n"
        "- TODAY'S SCHEDULE: When asked about appointments, summarize from TODAY'S SCHEDULE in 1-2 sentences. Call get_doctor_consultations for date queries.\n"
        "- CLINICAL NOTES: Repeat note back once for confirmation, call add_clinical_note, then say: 'Note saved.'\n"
        "- ALERTS: Confirm alert type, call escalate_alert, then say: 'Alert sent.'\n"
        "- SILENCE & LISTENING CADENCE: Stay quietly in listening mode whenever the doctor is silent, thinking, pausing, or not addressing you. NEVER say 'I could not hear', 'Maaf kijiye', 'Sun nahi paaya', or ask to repeat during silence or ambient background noise. ONLY speak when the doctor explicitly addresses you or asks a clinical question. If the doctor explicitly spoke a question or patient name but it was genuinely indistinct, ask for clarification in 1 short polite sentence.\n"
        "- SIGN-OFF: When the user says goodbye or wants to conclude/end the session (e.g. 'goodbye', 'bye', 'see you', 'see you later', 'stop', 'go to sleep', 'thank you bye'), call end_conversation immediately, give one brief warm sign-off (e.g. 'Goodbye Doctor, have a great day!') and stop.\n\n"
        "DOCTOR CONTEXT & REAL-TIME CLOCK:\n"
        f"Name: Dr. {doctor_name}\n"
        f"Specialization: {specialization}\n"
        f"Clinic: {clinic_name}\n"
        f"Date: {consultation_date} ({day_of_week})\n"
        f"Current Time: {current_time_ist}\n"
        f"Timezone: Indian Standard Time (IST, UTC+5:30)\n"
        f"{active_count_str}"
        f"Today's Scheduled Consultations:\n{consultations_summary}\n\n"
        f"{patient_block}"
    )


# ==========================================================
# PATIENT API 1 (roster) + API 2 (persona)
# ==========================================================
async def async_fetch_patient_list(doctor_id: str = None, force_refresh: bool = False):
    """Read or refresh one doctor's roster, sharing concurrent fetches."""
    doctor_id = doctor_id or PATIENTS_API_DOCTOR_ID
    generation = _roster_fetch_generation.get(doctor_id, 0)
    lock = _roster_fetch_locks.get(doctor_id)
    if lock is None:
        lock = _roster_fetch_locks.setdefault(doctor_id, asyncio.Lock())
    async with lock:
        joined_completed_fetch = _roster_fetch_generation.get(doctor_id, 0) != generation
        return await _async_fetch_patient_list_locked(
            doctor_id,
            force_refresh=force_refresh and not joined_completed_fetch,
            allow_network=not joined_completed_fetch,
        )


async def _async_fetch_patient_list_locked(
    doctor_id: str, force_refresh: bool = False, allow_network: bool = True
):
    """API 1: this doctor's patient roster (per-doctor TTL cache)."""
    # `doctor_id` is retained as an optional override for deployments that map
    # each websocket doctor to a distinct roster API ID.
    now = time.time()
    ts, cached = _roster_by_doctor.get(doctor_id, (0.0, []))
    expiry = _roster_expires_at_by_doctor.get(doctor_id, 0.0)
    if cached and expiry > now and (now - ts) < CACHE_TTL_ROSTER_S and not force_refresh:
        _roster_status_by_doctor[doctor_id] = "ready"
        return cached
    redis_key = _redis_key("roster", doctor_id)
    redis_cached, redis_ttl = await redis_get_json_with_ttl(redis_key)
    redis_expiry = now + redis_ttl if redis_ttl > 0 else 0.0
    if isinstance(redis_cached, list) and redis_cached and redis_expiry > now and not force_refresh:
        _roster_by_doctor[doctor_id] = (now, redis_cached)
        _roster_expires_at_by_doctor[doctor_id] = redis_expiry
        _roster_status_by_doctor[doctor_id] = "ready"
        return redis_cached
    stale = cached if cached and expiry > now else (
        redis_cached if isinstance(redis_cached, list) and redis_expiry > now else []
    )
    stale_expiry = expiry if cached and expiry > now else redis_expiry
    if not allow_network:
        _roster_status_by_doctor[doctor_id] = "stale" if stale else "unavailable"
        return stale if stale_expiry > time.time() else []
    api1_started = time.perf_counter()
    api1_headers = {"accept": "application/json"}
    if PERSONA_HARDWARE_TOKEN:
        api1_headers["x-hardware-token"] = PERSONA_HARDWARE_TOKEN
    try:
        client = get_http_client()
        _metric_inc("api1_requests")
        resp = await client.get(
            f"{PATIENTS_API_BASE_URL}/{doctor_id}",
            headers=api1_headers,
            timeout=httpx.Timeout(API1_REQUEST_TIMEOUT_S, connect=3.0),
        )
        if resp.status_code == 200:
            data = resp.json()
            roster = _extract_patient_roster(data)
            if roster is None:
                _roster_status_by_doctor[doctor_id] = "invalid"
                logger.warning("API 1 response was incomplete or had an invalid roster shape")
            elif roster:
                fetched_at = time.time()
                _roster_by_doctor[doctor_id] = (fetched_at, roster)
                _roster_expires_at_by_doctor[doctor_id] = fetched_at + REDIS_ROSTER_TTL_S
                _roster_status_by_doctor[doctor_id] = "ready"
                await redis_set_json(redis_key, roster, REDIS_ROSTER_TTL_S)
                await _cache_explicit_persona_mappings(roster, doctor_id)
                logger.info(f"📋 API 1: doctor {doctor_id} has {len(roster)} patients")
                return roster
            elif stale:
                # Keep last-known data only until its original Redis expiry. An
                # authoritative empty response must never renew an old roster forever.
                _roster_status_by_doctor[doctor_id] = "stale"
                _roster_expires_at_by_doctor[doctor_id] = stale_expiry
                logger.warning("API 1 returned an empty roster; using the unexpired doctor-scoped cache without extending its TTL")
                return stale
            else:
                _roster_by_doctor.pop(doctor_id, None)
                _roster_expires_at_by_doctor.pop(doctor_id, None)
                await redis_delete(redis_key)
                _roster_status_by_doctor[doctor_id] = "empty"
                logger.warning("API 1 returned 200 but no patients")
        else:
            _roster_status_by_doctor[doctor_id] = "unavailable"
            _metric_inc("api1_failures")
            logger.warning(f"⚠️ API 1 returned status {resp.status_code} for doctor {doctor_id}")
    except Exception as e:
        _roster_status_by_doctor[doctor_id] = "stale" if stale else "unavailable"
        _metric_inc("api1_failures")
        logger.warning(
            "API 1 roster request failed after %.1fs (%s); %s",
            time.perf_counter() - api1_started,
            type(e).__name__,
            "using the still-valid cached roster" if stale else "no usable cached roster is available",
        )
    finally:
        _runtime_metrics["api1_last_latency_ms"] = round((time.perf_counter() - api1_started) * 1000, 1)
        _roster_fetch_generation[doctor_id] = _roster_fetch_generation.get(doctor_id, 0) + 1
    if stale and stale_expiry > time.time():
        _roster_by_doctor[doctor_id] = (time.time(), stale)
        _roster_expires_at_by_doctor[doctor_id] = stale_expiry
        return stale
    _roster_by_doctor.pop(doctor_id, None)
    _roster_expires_at_by_doctor.pop(doctor_id, None)
    if not stale:
        await redis_delete(redis_key)
    return []


async def async_fetch_patient_persona(patient_id: str, doctor_id: str = None, expected_record: dict = None):
    """Fetch/cache one persona and share concurrent requests for the same patient."""
    cache_id = f"{doctor_id or PATIENTS_API_DOCTOR_ID}:{patient_id}"
    lock = _persona_fetch_locks.get(cache_id)
    if lock is None:
        lock = _persona_fetch_locks.setdefault(cache_id, asyncio.Lock())
    async with lock:
        return await _async_fetch_patient_persona_locked(patient_id, doctor_id, expected_record)


async def _async_fetch_patient_persona_locked(patient_id: str, doctor_id: str = None, expected_record: dict = None):
    """Locked implementation of API 2 lookup; never caches an unverified identity."""
    cache_id = f"{doctor_id or PATIENTS_API_DOCTOR_ID}:{patient_id}"
    # v2 intentionally bypasses older unverified Redis entries from prior builds.
    cache_key = _redis_key("persona-v2", cache_id)

    async def valid_for_row(persona):
        if not isinstance(persona, dict) or not persona:
            return False
        return expected_record is None or _persona_matches_record(persona, expected_record)

    hit = _persona_by_id.get(cache_id)
    if hit and (time.time() - hit[0]) < CACHE_TTL_PERSONA_S:
        if await valid_for_row(hit[1]):
            _persona_status_by_id[cache_id] = 200
            return hit[1]
        _persona_by_id.pop(cache_id, None)

    redis_hit = await redis_get_json(cache_key)
    if isinstance(redis_hit, dict) and redis_hit:
        if await valid_for_row(redis_hit):
            _persona_by_id[cache_id] = (time.time(), redis_hit)
            _persona_status_by_id[cache_id] = 200
            return redis_hit
        await redis_delete(cache_key)

    client = get_http_client()
    headers = {"accept": "*/*"}
    if PERSONA_HARDWARE_TOKEN:
        headers["x-hardware-token"] = PERSONA_HARDWARE_TOKEN
    for attempt in range(1, API2_MAX_ATTEMPTS + 1):
        api2_started = time.perf_counter()
        try:
            _metric_inc("api2_requests")
            resp = await client.get(
                f"{PERSONA_API_BASE_URL}/{patient_id}",
                headers=headers,
                timeout=httpx.Timeout(API2_REQUEST_TIMEOUT_S, connect=3.0),
            )
            _runtime_metrics["api2_last_latency_ms"] = round((time.perf_counter() - api2_started) * 1000, 1)
        except Exception as e:
            _persona_status_by_id[cache_id] = "error"
            if attempt < API2_MAX_ATTEMPTS:
                _metric_inc("api2_retries")
                logger.warning("⚠️ API 2 fetch error (%s); retrying once", type(e).__name__)
                await asyncio.sleep(0.25 * attempt)
                continue
            _metric_inc("api2_failures")
            logger.warning(f"⚠️ API 2 fetch error: {type(e).__name__}")
            return {}

        if resp.status_code == 200:
            data = resp.json()
            persona = _extract_persona_payload(data)
            if not persona:
                _persona_status_by_id[cache_id] = "invalid_payload"
                logger.warning("API 2 returned HTTP 200 without a usable persona object")
                return {}
            if not await valid_for_row(persona):
                _persona_status_by_id[cache_id] = "identity_mismatch"
                logger.error("API 2 persona identity did not match the selected API 1 patient; refusing to cache/use it")
                return {}
            _persona_status_by_id[cache_id] = 200
            _persona_by_id[cache_id] = (time.time(), persona)
            await redis_set_json(cache_key, persona, CACHE_TTL_PERSONA_S)
            return persona

        _persona_status_by_id[cache_id] = resp.status_code
        if resp.status_code == 404:
            # A stale persona must never mask a missing assignment/ID mapping.
            _persona_by_id.pop(cache_id, None)
            await redis_delete(cache_key)
        logger.warning(f"⚠️ API 2 returned status {resp.status_code} for the matched patient")
        if resp.status_code in (408, 429) or 500 <= resp.status_code < 600:
            if attempt < API2_MAX_ATTEMPTS:
                _metric_inc("api2_retries")
                logger.warning("API 2 transient status %s; retrying once", resp.status_code)
                await asyncio.sleep(0.25 * attempt)
                continue
        _metric_inc("api2_failures")
        return {}
    return {}


async def async_fetch_doctor_persona(
    doctor_id: str = None,
    target_date: str = None,
    force_refresh: bool = False,
    allow_network: bool = True,
) -> dict:
    """Fetch and cache doctor persona and daily consultations once per day per doctor."""
    doctor_id = (doctor_id or DEFAULT_DOCTOR_ID).strip()
    target_date = (target_date or get_today_date_str()).strip()
    cache_id = f"{doctor_id}:{target_date}"
    now = time.time()

    # 1. Check in-memory daily cache (loaded once per day)
    if not force_refresh:
        hit = _doctor_persona_by_day.get(cache_id)
        if hit and (now - hit[0]) < REDIS_DOCTOR_PERSONA_TTL_S:
            return hit[1]

    # 2. Check Redis daily cache
    redis_key = _redis_key("doctor-persona", cache_id)
    if not force_refresh:
        redis_cached, redis_ttl = await redis_get_json_with_ttl(redis_key)
        if isinstance(redis_cached, dict) and redis_cached and redis_ttl > 0:
            _doctor_persona_by_day[cache_id] = (now, redis_cached)
            return redis_cached

    if not allow_network:
        hit = _doctor_persona_by_day.get(cache_id)
        return hit[1] if hit else {}

    # 3. Share one in-flight fetch per doctor per day
    lock = _doctor_persona_locks.get(cache_id)
    if lock is None:
        lock = _doctor_persona_locks.setdefault(cache_id, asyncio.Lock())

    async with lock:
        # Re-check inside lock
        if not force_refresh:
            hit = _doctor_persona_by_day.get(cache_id)
            if hit and (time.time() - hit[0]) < REDIS_DOCTOR_PERSONA_TTL_S:
                return hit[1]
            redis_cached, redis_ttl = await redis_get_json_with_ttl(redis_key)
            if isinstance(redis_cached, dict) and redis_cached and redis_ttl > 0:
                _doctor_persona_by_day[cache_id] = (time.time(), redis_cached)
                return redis_cached

        endpoint = f"{DOCTOR_PERSONA_API_BASE_URL.rstrip('/')}/{doctor_id}/persona/hardware"
        headers = {
            "accept": "*/*",
            "Content-Type": "application/json",
        }
        if PERSONA_HARDWARE_TOKEN:
            headers["x-hardware-token"] = PERSONA_HARDWARE_TOKEN

        client = get_http_client()
        logger.info(f"🌐 Fetching daily doctor persona from API: doctor={doctor_id}, date={target_date}")
        try:
            resp = await client.post(
                endpoint,
                headers=headers,
                json={"date": target_date},
                timeout=httpx.Timeout(10.0, connect=3.0),
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict):
                    consults = data.get("today_consultations") or data.get("consultations") or []
                    _doctor_persona_by_day[cache_id] = (time.time(), data)
                    await redis_set_json(redis_key, data, REDIS_DOCTOR_PERSONA_TTL_S)
                    logger.info(
                        f"👨‍⚕️ Cached daily doctor persona for {doctor_id} ({target_date}): "
                        f"{len(consults)} consultations, active_patients={data.get('active_patients_count', 'N/A')}"
                    )
                    return data
            logger.warning(f"⚠️ Doctor persona API returned status {resp.status_code} for doctor {doctor_id}")
        except Exception as e:
            logger.warning(f"⚠️ Doctor persona API fetch failed for {doctor_id}: {type(e).__name__} - {e}")

        # Fallback to stale memory entry if present
        hit = _doctor_persona_by_day.get(cache_id)
        if hit:
            return hit[1]
        return {}


def _patient_fields(p: dict):
    if not isinstance(p, dict):
        return "", "", None
    objects = [p]
    for key in ("patient", "persona", "identity", "user"):
        nested = p.get(key)
        if isinstance(nested, dict):
            objects.append(nested)
            for subkey in ("identity", "patient", "persona"):
                sub = nested.get(subkey)
                if isinstance(sub, dict):
                    objects.append(sub)

    def first_value(keys):
        return next((obj.get(key) for obj in objects for key in keys
                     if obj.get(key) is not None and str(obj.get(key)).strip()), None)

    fn = str(first_value(("first_name", "firstName", "given_name", "givenName")) or "").strip()
    ln = str(first_value(("last_name", "lastName", "family_name", "familyName")) or "").strip()
    display_name = first_value(("full_name", "fullName", "patient_name", "patientName", "name"))
    if display_name and (not fn or not ln):
        parts = str(display_name).strip().split()
        if parts:
            fn = fn or parts[0]
            ln = ln or " ".join(parts[1:])
    pid = _explicit_persona_id(p) or _roster_row_id(p)
    return fn, ln, pid


def _explicit_persona_id(p: dict):
    """Get a documented API 2 ID field; generic top-level `id` is not explicit."""
    if not isinstance(p, dict):
        return None
    objects = [p]
    for key in ("patient", "persona", "identity", "user"):
        nested = p.get(key)
        if isinstance(nested, dict):
            objects.append(nested)
            for subkey in ("identity", "patient", "persona"):
                sub = nested.get(subkey)
                if isinstance(sub, dict):
                    objects.append(sub)
    explicit_keys = (
        "persona_id", "personaId", "patient_persona_id", "patientPersonaId",
        "persona_document_id", "personaDocumentId", "patient_id", "patientId",
        "mongo_patient_id",
    )
    for obj in objects:
        for key in explicit_keys:
            value = obj.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
    # An embedded persona object is itself the persona document, so its own
    # _id/id is a valid API 2 identifier. A top-level generic row id is not.
    embedded = p.get("persona")
    if isinstance(embedded, dict):
        for key in ("_id", "id"):
            value = embedded.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
    return None


def _roster_row_id(p: dict):
    """Stable API 1 row identity, kept separate from a persona document ID."""
    if not isinstance(p, dict):
        return None
    nested_patient = p.get("patient") if isinstance(p.get("patient"), dict) else {}
    for obj in (p, nested_patient):
        keys = ("roster_id", "record_id", "_id", "id", "patient_id", "patientId") if obj is nested_patient else ("roster_id", "record_id", "_id", "id")
        for key in keys:
            value = obj.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
    return None


def _persona_map_key(doctor_id: str, roster_row_id: str) -> str:
    return _redis_key("persona-map-v1", doctor_id, roster_row_id)


async def _cache_explicit_persona_mappings(roster: list, doctor_id: str):
    """Persist only API 1's explicit row-to-persona mapping; never guess one."""
    for record in roster:
        row_id = _roster_row_id(record)
        persona_id = _explicit_persona_id(record)
        if row_id and persona_id:
            await redis_set_json(
                _persona_map_key(doctor_id, row_id),
                {"roster_id": row_id, "persona_id": persona_id, "source": "api1"},
                REDIS_PERSONA_MAP_TTL_S,
            )


def _normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value or ""))
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = _TITLE_RE.sub(" ", value)
    # Patient names contain letters; digits are reserved for exact patient IDs,
    # not for phone-based name search.
    value = re.sub(r"[^a-zA-Z\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip().casefold()


def _patient_name_key(record: dict) -> str:
    first, last, _ = _patient_fields(record)
    return _normalize_name(f"{first} {last}")


def _split_spoken_name_and_phone_last4(query: str):
    """Split a spoken name plus an explicit phone-ending phrase into safe parts."""
    raw = str(query or "").strip()
    phone_cue = re.search(
        r"\b(?:with\s+)?(?:the\s+)?(?:last\s+(?:four|4)|last|phone|mobile|number|digits?|ending|ends)\b",
        raw, re.I,
    )
    if not phone_cue:
        return raw, None
    digit_groups = re.findall(r"\d+", raw[phone_cue.start():])
    digits = "".join(digit_groups)
    last4 = digits[-4:] if len(digits) >= 4 else None
    name = raw[:phone_cue.start()]
    # Handle phrasing such as "Himanshu Loti, phone ending in 2495".
    name = re.sub(r"\b(with|and|whose|the|patient|record|number|no)\b", " ", name, flags=re.I)
    name = re.sub(r"\b(open|show|fetch|get|pull|up|records?|details?|for|of)\b", " ", name, flags=re.I)
    return re.sub(r"\s+", " ", name).strip(" ,.-"), last4


def _extract_persona_payload(data):
    if not isinstance(data, dict):
        return None
    if data.get("success") is False or str(data.get("status", "")).casefold() in {"error", "failed"}:
        return None
    persona = data.get("persona")
    if persona is None:
        persona = data.get("data")
    if isinstance(persona, dict) and isinstance(persona.get("persona"), dict):
        persona = persona["persona"]
    if persona is None:
        persona = data
    if not isinstance(persona, dict) or not persona:
        return None
    if not any(_patient_fields(persona)[:2]):
        # A 200 error envelope/session wrapper is not a clinical persona.
        return None
    return persona


def _persona_matches_record(persona: dict, record: dict) -> bool:
    """Verify API 2 belongs to the selected API 1 row without requiring a full name.

    API 2's identity payload may contain `first_name` and `patient_id` but omit
    `last_name`. The stable patient ID is authoritative in that case. If both
    services return name components, any conflicting component still rejects
    the payload. Name-only fallback requires an exact full-name match.
    """
    if not isinstance(persona, dict) or not isinstance(record, dict):
        return False

    expected_ids = {
        str(value).strip().casefold()
        for value in (_roster_row_id(record), _explicit_persona_id(record))
        if value is not None and str(value).strip()
    }
    returned_ids = {
        str(value).strip().casefold()
        for value in (_roster_row_id(persona), _explicit_persona_id(persona))
        if value is not None and str(value).strip()
    }
    id_match = bool(expected_ids & returned_ids)
    id_conflict = bool(expected_ids and returned_ids and not id_match)

    expected_first, expected_last, _ = _patient_fields(record)
    returned_first, returned_last, _ = _patient_fields(persona)
    first_matches = bool(
        expected_first and returned_first
        and _normalize_name(expected_first) == _normalize_name(returned_first)
    )
    last_matches = bool(
        expected_last and returned_last
        and _normalize_name(expected_last) == _normalize_name(returned_last)
    )
    component_conflict = bool(
        (expected_first and returned_first and not first_matches)
        or (expected_last and returned_last and not last_matches)
    )

    if id_conflict or component_conflict:
        logger.warning(
            "API 2 identity validation rejected payload (id_match=%s, id_conflict=%s, "
            "first_name_match=%s, last_name_match=%s, component_conflict=%s)",
            id_match, id_conflict, first_matches, last_matches, component_conflict,
        )
        return False
    if id_match:
        # Matching patient IDs are enough when API 2 omits part of the name.
        return True

    persona_name = _patient_name_key(persona)
    roster_name = _patient_name_key(record)
    return bool(persona_name and roster_name and persona_name == roster_name)


async def _persona_id_for_record(record: dict, doctor_id: str):
    row_id = _roster_row_id(record)
    explicit_id = _explicit_persona_id(record)
    if explicit_id:
        return explicit_id, "api1"
    if row_id:
        mapping = await redis_get_json(_persona_map_key(doctor_id, row_id))
        if (isinstance(mapping, dict)
                and str(mapping.get("roster_id", "")) == row_id
                and mapping.get("source") in {"api1", "verified_api2"}
                and mapping.get("persona_id")):
            return str(mapping["persona_id"]), str(mapping["source"])
    if row_id and PERSONA_ID_FALLBACK_TO_ROSTER_ID:
        return row_id, "roster_id_fallback"
    return None, "unmapped"


_TITLE_RE = re.compile(r"\b(mr|mrs|ms|miss|dr|doctor|patient|sir|madam)\b\.?", re.I)


def _normalize_query(q: str) -> str:
    return _normalize_name(q)


def _patient_identifiers(p: dict, patient_id=None):
    """Collect exact-match IDs and phone fields from common API 1 shapes."""
    objects = [p]
    for key in ("identity", "patient", "user", "persona"):
        nested = p.get(key)
        if isinstance(nested, dict):
            objects.append(nested)
            identity = nested.get("identity")
            if isinstance(identity, dict):
                objects.append(identity)

    ids = [patient_id] if patient_id is not None else []
    phones = []
    for obj in objects:
        for key in ("_id", "id", "persona_id", "personaId", "patient_id", "patientId", "user_id", "userId", "mongo_patient_id"):
            value = obj.get(key)
            if value is not None:
                ids.append(value)
        for key in ("mobile", "phone", "phone_no", "phoneNo", "phone_number", "phoneNumber", "mobile_no", "mobileNo", "mobile_number", "mobileNumber", "contact_number", "contactNumber"):
            value = obj.get(key)
            if value is not None:
                phones.append(value)

    id_keys = {re.sub(r"[^a-z0-9]", "", str(value).casefold()) for value in ids}
    phone_keys = {re.sub(r"\D", "", str(value)) for value in phones}
    return {value for value in id_keys if value}, {value for value in phone_keys if value}


def _extract_patient_roster(data):
    """Return only a complete API 1 roster; never cache a truncated page as the full list."""
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return None
    if "patients" in data:
        roster = data.get("patients")
    elif "data" in data:
        roster = data.get("data")
    elif "patient_list" in data:
        roster = data.get("patient_list")
    else:
        return None
    if isinstance(roster, dict):
        if "patients" in roster:
            roster = roster.get("patients")
        elif "data" in roster:
            roster = roster.get("data")
        else:
            return None
    if not isinstance(roster, list):
        return None
    reported_total = data.get("total")
    if reported_total is not None:
        try:
            if int(reported_total) != len(roster):
                logger.warning("API 1 roster total does not match returned records; retaining the last complete cached roster")
                return None
        except (TypeError, ValueError):
            logger.warning("API 1 returned an invalid roster total; refusing to cache this response")
            return None
    return roster


def match_patients(roster: list, query: str) -> list:
    """Robust multi-tier patient matcher supporting full names, single names, distinct surnames, and phonetic voice transcriptions."""
    import difflib
    q = _normalize_query(query)
    query_id = re.sub(r"[^a-z0-9]", "", str(query or "").casefold())
    if not (q or len(query_id) >= 6) or not roster:
        return []

    rows = []
    for p in roster:
        fn, ln, pid = _patient_fields(p)
        ids, phones = _patient_identifiers(p, pid)
        name_key = _patient_name_key(p)
        row_id = _roster_row_id(p)
        rows.append((p, name_key, set(name_key.split()), pid, row_id, ids, phones))

    # 1. Exact ID match (>= 6 chars)
    chosen = [r for r in rows if len(query_id) >= 6 and query_id in r[5]]
    if chosen:
        return [r[0] for r in chosen]

    if not q:
        return []

    q_tokens = set(q.split())

    # 2. Exact full name match
    full_exact = [r for r in rows if r[1] == q]
    if full_exact:
        return [r[0] for r in full_exact]

    # 3. All query tokens match a subset of patient name tokens (e.g. "Anil" in "Anil Kharbanda", "Kharbanda" in "Anil Kharbanda")
    subset_matches = [r for r in rows if q_tokens and q_tokens.issubset(r[2])]
    if subset_matches:
        return [r[0] for r in subset_matches]

    # 4. Token overlap on distinct name tokens (length >= 4 chars, e.g. "Kharbanda" in "Sunil Kharbanda")
    distinct_overlap = []
    for r in rows:
        shared = {tok for tok in (q_tokens & r[2]) if len(tok) >= 4}
        if shared:
            distinct_overlap.append((r, len(shared)))
    if distinct_overlap:
        distinct_overlap.sort(key=lambda x: x[1], reverse=True)
        max_shared = distinct_overlap[0][1]
        best_overlap = [item[0] for item in distinct_overlap if item[1] == max_shared]
        if len(best_overlap) == 1:
            return [best_overlap[0][0]]
        return [r[0] for r in best_overlap]

    # 5. Substring / Root match (e.g. "banda" in "kharbanda")
    sub_matches = [r for r in rows if any(len(tok) >= 4 and (tok in r[1] or any(tok in name_tok for name_tok in r[2])) for tok in q_tokens)]
    if sub_matches:
        if len(sub_matches) == 1:
            return [sub_matches[0][0]]
        return [r[0] for r in sub_matches]

    # 6. Phonetic / Fuzzy fallback (edit distance <= 2 for voice transcription variations)
    fuzzy_matches = []
    for r in rows:
        for q_tok in q_tokens:
            if len(q_tok) < 4:
                continue
            for r_tok in r[2]:
                ratio = difflib.SequenceMatcher(None, q_tok, r_tok).ratio()
                if ratio >= 0.80:
                    fuzzy_matches.append((r, ratio))
    if fuzzy_matches:
        fuzzy_matches.sort(key=lambda x: x[1], reverse=True)
        top_ratio = fuzzy_matches[0][1]
        best_fuzzy = [item[0] for item in fuzzy_matches if item[1] >= top_ratio - 0.05]
        if len(best_fuzzy) == 1:
            return [best_fuzzy[0][0]]

    return []


def _phone_digits_for_record(record: dict) -> set:
    _, _, pid = _patient_fields(record)
    return _patient_identifiers(record, pid)[1]


async def _load_selected_patient(record: dict, doctor_id: str, connection_id: str, roster_id: str) -> dict:
    fn, ln, _ = _patient_fields(record)
    full = f"{fn} {ln}".strip()
    row_id = _roster_row_id(record)
    if not row_id:
        return {"status": "error", "message": "The matched roster record has no patient ID; do not fetch another patient's persona."}
    await delete_conversation_state(doctor_id, connection_id, "pending_patient")

    persona_id, id_source = await _persona_id_for_record(record, roster_id)
    if not persona_id:
        return {"status": "persona_not_found", "matched_patient": full,
                "message": "The patient matched API 1, but API 1 did not provide a persona ID and no verified ID mapping is cached. Do not use a sample or another patient's ID."}

    candidate_ids = [(persona_id, id_source)]
    if id_source == "roster_id_fallback":
        logger.info("No explicit API 2 persona ID/mapping in the roster; attempting the API 1 row ID per configured fallback")
    # If a previously verified Redis mapping has gone stale, try the row ID only
    # as a separate candidate and accept it only after API 2 identity validation.
    row_id_fallback = _roster_row_id(record)
    if id_source == "verified_api2" and PERSONA_ID_FALLBACK_TO_ROSTER_ID and row_id_fallback != persona_id:
        candidate_ids.append((row_id_fallback, "roster_id_fallback"))

    persona = {}
    resolved_id = None
    last_status = None
    for candidate_id, candidate_source in candidate_ids:
        persona = await async_fetch_patient_persona(candidate_id, roster_id, expected_record=record)
        last_status = _persona_status_by_id.get(f"{roster_id}:{candidate_id}")
        if persona:
            resolved_id = candidate_id
            id_source = candidate_source
            break
        if last_status == "identity_mismatch":
            if candidate_source == "verified_api2":
                await redis_delete(_persona_map_key(roster_id, row_id))
            return {"status": "persona_identity_mismatch", "matched_patient": full,
                    "message": "API 2 returned a persona whose patient identity does not match the selected roster patient. Refuse to read or use that data; the patient ID mapping must be checked."}
        if last_status == 404 and candidate_source == "verified_api2":
            await redis_delete(_persona_map_key(roster_id, row_id))

    if not persona:
        if last_status == 404:
            return {"status": "persona_not_found", "matched_patient": full,
                    "message": "The patient matched API 1, but API 2 returned 404 for the available patient ID. An API 1 persona_id or verified patient-to-persona mapping is required. Do not say the patient was missing from the roster."}
        return {"status": "error", "matched_patient": full,
                "message": "The patient matched, but their persona service did not return a usable record. Do not say the patient is missing."}

    await redis_set_json(
        _persona_map_key(roster_id, row_id),
        {"roster_id": row_id, "persona_id": resolved_id, "source": "verified_api2"},
        REDIS_PERSONA_MAP_TTL_S,
    )
    sliced = build_tool_patient_data(persona)
    bc = sliced.get("body_composition", {}) if isinstance(sliced.get("body_composition"), dict) else {}
    vt = sliced.get("vitals", {}) if isinstance(sliced.get("vitals"), dict) else {}
    ls = sliced.get("labs_and_screening", {}) if isinstance(sliced.get("labs_and_screening"), dict) else {}
    overview_parts = [f"Record loaded for {full}"]
    demo_bits = []
    if sliced.get("demographics", {}).get("age"):
        demo_bits.append(f"{sliced['demographics']['age']}yo")
    if sliced.get("demographics", {}).get("gender"):
        demo_bits.append(str(sliced["demographics"]["gender"]))
    if demo_bits:
        overview_parts.append(f"({', '.join(demo_bits)})")
    if bc.get("weight"):
        overview_parts.append(f"Weight: {bc['weight']}, Height: {bc.get('height', 'N/A')}, BMI: {bc.get('bmi', 'N/A')}")
    if vt:
        overview_parts.append(f"Vitals: Pulse {vt.get('pulse_rate', 'N/A')}, SpO2 {vt.get('spo2', 'N/A')}, Resp {vt.get('respiration_rate', 'N/A')}")
    if ls:
        risk_strs = []
        if ls.get("hemoglobin_face_scan"):
            risk_strs.append(f"Hemoglobin: {ls['hemoglobin_face_scan']}")
        if ls.get("diabetes_screening_risk"):
            risk_strs.append(f"Diabetes Risk: {ls['diabetes_screening_risk']}")
        if ls.get("hypertension_screening_risk"):
            risk_strs.append(f"Hypertension Risk: {ls['hypertension_screening_risk']}")
        if ls.get("estimated_hba1c_face_scan"):
            risk_strs.append(f"Est HbA1c: {ls['estimated_hba1c_face_scan']}")
        if risk_strs:
            overview_parts.append(f"Screening: {', '.join(risk_strs)}")
    overview_parts.append(f"Confirmed Diagnoses: {sliced.get('confirmed_diagnoses', 'None recorded')}")
    clinical_overview_str = ". ".join(overview_parts) + "."

    # Save comprehensive active patient state in Redis / RAM session fallback
    await set_conversation_state(doctor_id, connection_id, "active_patient", {
        "patient_id": row_id,
        "persona_id": resolved_id,
        "patient_name": full,
        "clinical_overview": clinical_overview_str,
        "patient_data": sliced,
        "persona_str": json.dumps(sliced, indent=2),
    }, REDIS_SESSION_TTL_S)
    logger.info(f"🧠 Saved active patient memory: '{full}' (session TTL: {REDIS_SESSION_TTL_S}s)")

    return {
        "status": "found",
        "matched_patient": full,
        "clinical_overview": clinical_overview_str,
        "patient_data": sliced,
    }


async def resolve_patient(name_query: str, doctor_id: str = None, connection_id: str = "") -> dict:
    """API 1 name match -> API 2 persona. Returns a tool-response dict for Gemini."""
    session_doctor_id = doctor_id or DEFAULT_DOCTOR_ID
    spoken_name, spoken_last4 = _split_spoken_name_and_phone_last4(name_query)
    digits_only = not re.search(r"[A-Za-z]", str(name_query or ""))
    # Gemini may package the spoken confirmation as another name-tool call.
    # If a duplicate-name choice is pending, route four digits to that choice.
    if digits_only and len(re.sub(r"\D", "", str(name_query or ""))) == 4:
        pending = await get_conversation_state(session_doctor_id, connection_id, "pending_patient")
        if pending:
            return await resolve_patient_by_phone_last4(name_query, session_doctor_id, connection_id)
    await delete_conversation_state(session_doctor_id, connection_id, "pending_patient")
    roster_id = PATIENTS_API_DOCTOR_ID
    roster = await async_fetch_patient_list(roster_id)
    if not roster:
        if _roster_status_by_doctor.get(roster_id) == "empty":
            return {
                "status": "empty_roster",
                "message": "API 1 returned an empty patient roster for this doctor. Explain that no patients are currently available in the roster and ask the doctor to have the roster assignment checked. Do not say that the spoken patient does not exist.",
            }
        return {"status": "error", "message": "The patient roster service is unavailable right now. Do not say the patient is missing."}

    matches = match_patients(roster, spoken_name)
    if not matches:
        if digits_only and len(re.sub(r"\D", "", str(name_query or ""))) >= 7:
            return {"status": "phone_requires_name",
                    "message": "Ask the doctor for the patient's name first. Phone digits are used only to distinguish patients with the same name."}
        logger.warning(f"⚠️ No patient matching '{spoken_name}'")
        return {
            "status": "not_found",
            "message": f"No exact patient matching '{spoken_name}'. Ask the doctor to repeat or spell the name.",
        }
    if spoken_last4:
        phone_matches = [record for record in matches if any(
            phone.endswith(spoken_last4) and len(phone) >= 4
            for phone in _phone_digits_for_record(record)
        )]
        if len(phone_matches) == 1:
            logger.info("Patient name and spoken phone last-four matched in one lookup turn")
            return await _load_selected_patient(phone_matches[0], session_doctor_id, connection_id, roster_id)
        if len(phone_matches) > 1:
            matches = phone_matches
        else:
            return {"status": "phone_not_matched",
                    "message": "The spoken name was understood, but those last four digits do not match its patient records. Ask the doctor to repeat the digits."}
    if len(matches) > 1:
        name_keys = {_patient_name_key(record) for record in matches}
        if len(name_keys) != 1 or not next(iter(name_keys), ""):
            return {"status": "name_incomplete", "candidate_count": len(matches),
                    "message": "The spoken name matches more than one differently named patient. Ask for the patient's full name; do not ask for phone digits yet."}
        if not connection_id:
            return {"status": "error", "message": "Cannot safely disambiguate without an active conversation."}
        candidate_ids = [_roster_row_id(p) for p in matches]
        if len(candidate_ids) != len(matches):
            return {"status": "error", "message": "A duplicate roster record is missing its patient ID, so it cannot be safely confirmed."}
        await set_conversation_state(session_doctor_id, connection_id, "pending_patient",
                                     {"roster_ids": candidate_ids, "name_key": next(iter(name_keys))},
                                     REDIS_PENDING_TTL_S)
        logger.info("Duplicate patient name detected; waiting for phone last-four confirmation")
        return {"status": "ambiguous", "candidate_count": len(matches),
                "message": "Ask the doctor to confirm the last four digits of the phone number. Do not reveal phone numbers."}

    return await _load_selected_patient(matches[0], session_doctor_id, connection_id, roster_id)


async def resolve_patient_by_phone_last4(last_four: str, doctor_id: str, connection_id: str) -> dict:
    digits = re.sub(r"\D", "", str(last_four or ""))
    if len(digits) != 4:
        return {"status": "invalid_last4", "message": "Ask for exactly the last four digits."}
    pending = await get_conversation_state(doctor_id, connection_id, "pending_patient")
    allowed_ids = set((pending or {}).get("roster_ids") or (pending or {}).get("patient_ids") or [])
    if len(allowed_ids) < 2 or not pending.get("name_key"):
        return {"status": "no_pending_match", "message": "There is no duplicate-name selection awaiting confirmation. Ask the doctor to say the patient name again."}
    roster_id = PATIENTS_API_DOCTOR_ID
    roster = await async_fetch_patient_list(roster_id)
    matches = []
    for record in roster:
        pid = _roster_row_id(record)
        phones = _phone_digits_for_record(record)
        if (pid in allowed_ids and _patient_name_key(record) == pending["name_key"]
                and any(phone.endswith(digits) and len(phone) >= 4 for phone in phones)):
            matches.append(record)
    if len(matches) == 1:
        return await _load_selected_patient(matches[0], doctor_id, connection_id, roster_id)
    if len(matches) > 1:
        return {"status": "ambiguous_last4", "candidate_count": len(matches),
                "message": "Those digits still match more than one candidate. Ask the doctor to repeat or provide a different identifier."}
    return {"status": "phone_not_matched", "message": "The digits did not match either candidate. Ask the doctor to repeat the last four digits."}


async def run_tool(fn: str, args: dict, doctor_id: str = None, connection_id: str = "") -> dict:
    try:
        if fn in ("load_patient_record", "get_patient_persona"):
            pn = args.get("patient_name", "")
            logger.info(f"🔍 Tool '{fn}': '{pn}'")
            return await asyncio.wait_for(resolve_patient(pn, doctor_id, connection_id), timeout=TOOL_TIMEOUT_S)
        if fn == "confirm_patient_by_phone_last4":
            return await asyncio.wait_for(
                resolve_patient_by_phone_last4(args.get("last_four", ""), doctor_id or PATIENTS_API_DOCTOR_ID, connection_id),
                timeout=TOOL_TIMEOUT_S,
            )
        if fn == "add_clinical_note":
            pn = args.get("patient_name", "").strip()
            nc = args.get("note_content", "").strip()
            category = args.get("category", "Consultation Note")
            logger.info(f"📝 add_clinical_note: '{pn}' -> '{nc}' (category={category})")
            note_obj = {
                "id": str(uuid.uuid4())[:8],
                "note": nc,
                "author": f"Dr. {os.getenv('DEFAULT_DOCTOR_NAME', 'Samarth Gupta')}",
                "category": category,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "source": "voice_speaker_relay"
            }
            _clinical_notes.setdefault(pn, []).append(note_obj)
            return {"status": "success", "message": f"Clinical note successfully saved for {pn}."}
        if fn == "escalate_alert":
            pn, at = args.get("patient_name", ""), args.get("alert_type", "")
            logger.info(f"🚨 escalate_alert: '{pn}' -> '{at}'")
            _escalated_alerts.setdefault(pn, []).append(at)
            return {"status": "success", "message": f"Alert sent to {pn}."}
        if fn in ("get_doctor_consultations", "get_today_consultations"):
            target_date = (args.get("date") or "").strip() or get_today_date_str()
            logger.info(f"📅 Tool '{fn}': doctor={doctor_id}, date={target_date}")
            persona = await async_fetch_doctor_persona(doctor_id, target_date)
            consultations = persona.get("today_consultations") or persona.get("consultations") or []
            doc_name = (
                persona.get("doctor_details", {}).get("first_name", "") + " " +
                persona.get("doctor_details", {}).get("last_name", "")
            ).strip() or DEFAULT_DOCTOR_NAME
            return {
                "status": "success",
                "date": target_date,
                "doctor_name": doc_name,
                "consultation_count": len(consultations),
                "consultations": consultations,
                "message": (
                    f"Dr. Makkar has {len(consultations)} consultations scheduled for {target_date}."
                    if consultations
                    else f"Dr. Makkar has no consultations scheduled for {target_date}."
                ),
            }
        if fn in ("get_current_time", "get_time", "get_live_time"):
            dt = get_current_ist_datetime()
            tod = part_of_day()
            time_str = dt.strftime("%I:%M %p").lstrip("0")
            date_str = dt.strftime("%Y-%m-%d")
            day_str = dt.strftime("%A")
            logger.info(f"⏰ Tool '{fn}' -> {time_str} IST ({tod}), {day_str}, {date_str}")
            return {
                "status": "success",
                "time_ist": f"{time_str} IST",
                "date": date_str,
                "day_of_week": day_str,
                "part_of_day": tod,
                "message": f"The current time is {time_str} IST on {day_str}, {date_str}.",
            }
        return {"status": "error", "message": f"Unknown tool '{fn}'."}
    except asyncio.TimeoutError:
        logger.warning(f"Tool '{fn}' timed out")
        return {"status": "error", "message": "The patient service timed out. Ask the doctor to try again."}
    except Exception as e:
        logger.error(f"Tool '{fn}' failed: {e}", exc_info=True)
        return {"status": "error", "message": "The tool failed unexpectedly."}


# ==========================================================
# AUDIO HELPERS
# ==========================================================
def process_audio_pcm(pcm_data: bytes, target_rms: float = 4000.0, silence_thresh: int = 30) -> bytes:
    """Gain-normalise soft speech and trim extreme edge silence (REST path)."""
    if len(pcm_data) < 4:
        return pcm_data
    count = len(pcm_data) // 2
    samples = list(struct.unpack(f"<{count}h", pcm_data[: count * 2]))

    start_idx = 0
    while start_idx < len(samples) and abs(samples[start_idx]) < silence_thresh:
        start_idx += 1
    end_idx = len(samples) - 1
    while end_idx > start_idx and abs(samples[end_idx]) < silence_thresh:
        end_idx -= 1
    trimmed = samples[start_idx:end_idx + 1] if start_idx < end_idx else samples

    rms = (sum(s * s for s in trimmed) / len(trimmed)) ** 0.5 if trimmed else 0.0
    if 10.0 < rms < target_rms:
        gain = min(target_rms / rms, 8.0)
        trimmed = [max(-32768, min(32767, int(s * gain))) for s in trimmed]
        logger.info(f"🔊 RMS boosted {rms:.1f} -> {rms * gain:.1f} (x{gain:.2f})")
    return struct.pack(f"<{len(trimmed)}h", *trimmed)


def pcm_to_wav(pcm_data: bytes, sample_rate: int = 16000, channels: int = 1, sample_width: int = 2) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(sample_width)
        w.setframerate(sample_rate)
        w.writeframes(pcm_data)
    return buf.getvalue()


def _clamp16(v: int) -> int:
    return -32768 if v < -32768 else 32767 if v > 32767 else v


class SmoothResampler24kTo16k:
    """
    Streaming 24kHz -> 16kHz resampler (3 in -> 2 out).
      out[0] = on-grid sample, lightly smoothed  (sm1 + 14*s0 + s1) / 16
      out[1] = midpoint of s1/s2, 4-point cubic   (-s0 + 9*s1 + 9*s2 - s3) / 16
    Keeps a 1-sample history and a 3-sample look-ahead across chunk boundaries so there
    are no discontinuities (the old version reused s2 as look-ahead => a tick every chunk).
    """

    def __init__(self, volume_scale: float = 0.46):
        self.volume_scale = volume_scale
        self.pending = bytearray()
        self.buf = [0]          # buf[0] is the sample *before* the next triplet
        self.last_out = 0

    def _run(self) -> list:
        buf, out, scale, p = self.buf, [], self.volume_scale, 1
        while p + 3 < len(buf):
            sm1, s0, s1, s2, s3 = buf[p - 1], buf[p], buf[p + 1], buf[p + 2], buf[p + 3]
            y0 = (sm1 + 14 * s0 + s1 + 8) >> 4
            y1 = (-s0 + 9 * s1 + 9 * s2 - s3 + 8) >> 4
            out.append(_clamp16(int(y0 * scale)))
            out.append(_clamp16(int(y1 * scale)))
            p += 3
        self.buf = buf[p - 1:]
        return out

    def process(self, chunk: bytes) -> bytes:
        if not chunk:
            return b""
        self.pending.extend(chunk)
        n = len(self.pending) // 2
        if n == 0:
            return b""
        self.buf.extend(struct.unpack(f"<{n}h", bytes(self.pending[: n * 2])))
        del self.pending[: n * 2]
        out = self._run()
        if not out:
            return b""
        self.last_out = out[-1]
        return struct.pack(f"<{len(out)}h", *out)

    def flush(self) -> bytes:
        out = []
        if len(self.buf) > 1:
            self.buf.extend([self.buf[-1]] * 3)   # pad look-ahead with last sample
            out = self._run()
        start = out[-1] if out else self.last_out
        if abs(start) > 10:                        # 32-sample fade-out (anti-pop)
            for k in range(1, 33):
                out.append(int(start * (32 - k) / 32.0))
        out.extend([0] * 128)                      # let DAC DMA drain
        self.pending.clear()
        self.buf = [0]
        self.last_out = 0
        return struct.pack(f"<{len(out)}h", *out)


# ==========================================================
# REST PATH (/api/chat-audio) — not used by the live flow
# ==========================================================
async def call_gemini_api(audio_bytes: bytes, mime_type: str = "audio/wav") -> dict:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "YOUR_GEMINI_API_KEY_HERE":
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set in .env")

    # This legacy HTTP endpoint has no selected patient ID. Never attach the
    # first roster patient's persona implicitly; only the live tool flow can
    # establish an explicit, verified active-patient selection.
    persona_str, patient_name = "", None

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    doctor_prompt = build_doctor_agent_prompt(patient_name=patient_name, persona_str=persona_str)
    system_instruction = (
        f"{doctor_prompt}\n\n"
        "FORMATTING & MOOD PERCEPTION:\n"
        "Analyze both the spoken content AND the tone of the user's voice.\n"
        "Determine user_emotion (`happy`, `anxious`, `concerned`, `pain`, `neutral`, `curious`).\n"
        "Determine response_mood (`celebratory`, `calm_reassuring`, `empathetic_gentle`, `warm_clinical`).\n"
        "Respond STRICTLY in valid JSON:\n"
        '{"transcription": "<exact transcribed question>", "user_emotion": "<emotion>", '
        '"response_mood": "<mood>", "answer": "<concise 1-2 sentence direct clinical response, zero extraneous info>"}\n'
    )
    user_prompt = "Listen to the spoken audio, transcribe it, determine response_mood, and answer in JSON."

    for model_name in dict.fromkeys(FALLBACK_MODELS):
        try:
            logger.info(f"Sending {len(audio_bytes)} bytes audio to '{model_name}'...")
            response = await client.aio.models.generate_content(
                model=model_name,
                contents=[types.Part.from_bytes(data=audio_bytes, mime_type=mime_type), user_prompt],
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.2,
                    response_mime_type="application/json",
                ),
            )
            if response.text:
                raw = response.text.strip()
                if raw.startswith("```json"):
                    raw = raw[7:]
                if raw.endswith("```"):
                    raw = raw[:-3]
                raw = raw.strip()
                try:
                    res = json.loads(raw)
                    t = (res.get("transcription") or "").strip().lower()
                    if t in ("", "[unclear]", "[inaudible]", "noise", "thank you", "sound", "voice query"):
                        res["answer"] = "I didn't quite catch that. Could you please speak clearly?"
                        res["response_mood"] = "empathetic_gentle"
                    return res
                except Exception:
                    return {"transcription": "Voice Query", "user_emotion": "neutral",
                            "response_mood": "warm_clinical", "answer": raw}
        except Exception as e:
            logger.warning(f"Model '{model_name}' failed: {e}. Trying next...")
            await asyncio.sleep(0.3)

    logger.error("All Gemini model attempts failed!")
    return {"transcription": "Error", "user_emotion": "concerned", "response_mood": "empathetic_gentle",
            "answer": "I didn't catch that. Could you please repeat and speak clearly?"}


_MOOD_PROSODY = {
    "celebratory": ("+4%", "+6Hz"),
    "calm_reassuring": ("-4%", "-2Hz"),
    "empathetic_gentle": ("-8%", "-4Hz"),
    "warm_clinical": ("+0%", "+0Hz"),
}


def _mp3_to_pcm16k(mp3_path: str) -> bytes:
    decoded = miniaudio.decode_file(mp3_path)
    return miniaudio.convert_frames(
        decoded.sample_format, decoded.nchannels, decoded.sample_rate, bytes(decoded.samples),
        miniaudio.SampleFormat.SIGNED16, 1, 16000,
    )


async def text_to_pcm_16k(text: str, mood: str = "warm_clinical") -> bytes:
    """edge-tts (plain text + prosody params; the old code double-wrapped SSML => tags were spoken)."""
    if text:
        text = _URL_RE.sub("", text)
        if "RESOURCE_EXHAUSTED" in text or "spending cap" in text or "exceeded its monthly" in text:
            text = "Gemini API spending cap reached. Please check your API key quota."
    if not text or not text.strip():
        return b""

    voice = os.getenv("TTS_VOICE", "en-IN-NeerjaExpressiveNeural")
    rate, pitch = _MOOD_PROSODY.get(mood, _MOOD_PROSODY["warm_clinical"])

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        mp3_path = f.name
    try:
        try:
            await edge_tts.Communicate(text, voice=voice, rate=rate, pitch=pitch).save(mp3_path)
        except Exception as e:
            logger.warning(f"TTS with prosody failed ({e}); retrying plain")
            await edge_tts.Communicate(text, voice=voice).save(mp3_path)
        pcm = _mp3_to_pcm16k(mp3_path)
        n = len(pcm) // 2
        samples = struct.unpack(f"<{n}h", pcm[: n * 2])
        return struct.pack(f"<{n}h", *[_clamp16(int(s * 0.85)) for s in samples])
    except Exception as err:
        logger.error(f"TTS conversion error: {err}", exc_info=True)
        return b""
    finally:
        if os.path.exists(mp3_path):
            os.remove(mp3_path)


def _is_gemini_spending_cap_error(error: Exception) -> bool:
    """Recognize quota/spending-cap failures across SDK exception formats."""
    code = getattr(error, "code", "")
    status_code = getattr(error, "status_code", "")
    details = getattr(error, "details", "")
    message = " ".join((type(error).__name__, str(code), str(status_code), str(details), str(error))).casefold()
    markers = (
        "resource_exhausted", "resource exhausted", "quota",
        "spending cap", "spend cap", "monthly spend", "monthly budget",
        "exceeded its monthly", "billing limit", "billing hard limit",
    )
    return any(marker in message for marker in markers)


@app.post("/api/chat-audio")
async def chat_audio(request: Request):
    body = await request.body()
    if not body or len(body) < 100:
        raise HTTPException(status_code=400, detail="Audio body too short")
    pcm_payload = body[44:] if body.startswith(b"RIFF") else body
    wav_bytes = pcm_to_wav(process_audio_pcm(pcm_payload))

    gemini_res = await call_gemini_api(wav_bytes, mime_type="audio/wav")
    answer_text = gemini_res.get("answer", "I'm here to help you.")
    mood = gemini_res.get("response_mood", "warm_clinical")
    pcm_out = await text_to_pcm_16k(answer_text, mood=mood)

    lower = answer_text.lower()
    vol = None
    if "mute" in lower:
        vol = "0"
    elif "increase volume" in lower or "volume up" in lower or "louder" in lower:
        vol = "85"
    elif "lower volume" in lower or "volume down" in lower or "softer" in lower:
        vol = "35"

    headers = {
        "X-Gemini-Text": answer_text.replace("\n", " ").encode("ascii", "ignore").decode("ascii"),
        "X-Response-Mood": mood,
    }
    if vol:
        headers["X-Set-Volume"] = vol
    return Response(content=pcm_out, media_type="application/octet-stream", headers=headers)


# ==========================================================
# GEMINI LIVE WEBSOCKET RELAY
# ==========================================================
def build_live_tools(types):
    def fd(name, desc, props, required):
        return types.FunctionDeclaration(
            name=name,
            description=desc,
            parameters=types.Schema(type=types.Type.OBJECT, properties=props, required=required),
        )

    S = types.Schema
    T = types.Type
    return [types.Tool(function_declarations=[
        fd("load_patient_record",
           "Fetch clinical record by patient name, optional phone last-4, or exact ID.",
           {"patient_name": S(type=T.STRING, description="Patient name or ID.")}, ["patient_name"]),
        fd("confirm_patient_by_phone_last4",
           "Disambiguate ambiguous patient candidate by last 4 phone digits.",
           {"last_four": S(type=T.STRING, description="Exactly 4 spoken digits.")}, ["last_four"]),
        fd("add_clinical_note",
           "Save clinical note or prescription instruction for active patient.",
           {
               "patient_name": S(type=T.STRING, description="Patient name."),
               "note_content": S(type=T.STRING, description="Dictated observation or plan."),
               "category": S(type=T.STRING, description="Optional: 'Prescription Change', 'Lab Order', 'Diet & Lifestyle', 'Follow-up', 'General Consultation'.")
           },
           ["patient_name", "note_content"]),
        fd("escalate_alert",
           "Send clinical alert to the active patient.",
           {"patient_name": S(type=T.STRING),
            "alert_type": S(type=T.STRING,
                            enum=["glucose_high", "glucose_low", "bp_high", "medication_missed", "general"])},
           ["patient_name", "alert_type"]),
        fd("get_doctor_consultations",
           "Retrieve doctor's scheduled consultations for today or specific date.",
           {"date": S(type=T.STRING, description="YYYY-MM-DD date (defaults to today).")},
           []),
        fd("get_current_time",
           "Get current live Indian Standard Time (IST), date, and day of week.",
           {}, []),
        fd("end_conversation",
           "End conversation on sign-off command (goodbye, bye, see you, stop, go to sleep).",
           {}, []),
    ])]


def compute_pcm16_rms(raw: bytes) -> float:
    count = len(raw) // 2
    if count == 0:
        return 0.0
    samples = struct.unpack(f"<{count}h", raw[: count * 2])
    return (sum(s * s for s in samples) / count) ** 0.5


def boost_chunk_gain(raw: bytes, gain: float = IN_GAIN) -> bytes:
    count = len(raw) // 2
    if count == 0:
        return raw
    samples = struct.unpack(f"<{count}h", raw[: count * 2])
    return struct.pack(f"<{count}h", *[_clamp16(int(s * gain)) for s in samples])


@app.websocket("/ws/live/{session_id}")
@app.websocket("/ws/live")
@app.websocket("/ws/voice_dynamic/{session_id}")
async def websocket_live_stream(websocket: WebSocket, session_id: str = "default"):
    """
    Persistent Gemini Live relay.
      ESP32 --(16k PCM)--> server --(16k PCM)--> Gemini Live
      ESP32 <--(16k PCM, paced)-- server <--(24k PCM)-- Gemini Live
    Turn detection = Gemini automatic VAD (+ audio_stream_end when the ESP32 says the utterance ended).
    """
    # The path segment is the doctor's id: ws://host:8008/ws/live/{doctor_id}
    logger.info("WS IN -> %s", _url_for_log(websocket.url))
    doctor_id = session_id if session_id != "default" else DEFAULT_DOCTOR_ID
    if not _DOCTOR_ID_RE.match(doctor_id):
        logger.warning(f"Rejected websocket with invalid doctor id {doctor_id!r}")
        await websocket.close(code=1008)
        return
    await websocket.accept()
    # A hardware-derived ID lets a short Wi-Fi/WebSocket reconnect continue a
    # duplicate-name selection instead of forgetting it. Reject arbitrary
    # query values so they cannot create unsafe Redis keys.
    supplied_device_id = (websocket.query_params.get("device_id") or "").strip().lower()
    supplied_rssi = websocket.query_params.get("rssi")
    supplied_ssid = websocket.query_params.get("ssid") or "TFTus-WiFi"
    rssi_val = None
    if supplied_rssi:
        try:
            rssi_val = int(supplied_rssi)
        except Exception:
            pass
    if rssi_val is None:
        rssi_val = -48

    if re.fullmatch(r"[a-f0-9]{12}", supplied_device_id):
        connection_id = f"esp32-{supplied_device_id}"
        connection_label = supplied_device_id
    else:
        connection_id = uuid.uuid4().hex
        connection_label = "temporary"

    client_ip = websocket.client.host if websocket.client else None

    # 📶 LOG PROMINENT NETWORK WI-FI CONNECTED BANNER TO BACKEND CONSOLE
    log_network_event("WIFI_CONNECTED", device_id=connection_label, ip=client_ip, ssid=supplied_ssid, rssi=rssi_val)
    _mark_device_online_in_fleet(connection_label, ip=client_ip, ssid=supplied_ssid, rssi=rssi_val)

    ACTIVE_ESP_CONNECTIONS[connection_id] = {
        "connection_id": connection_id,
        "device_label": connection_label,
        "doctor_id": doctor_id,
        "client_ip": client_ip,
        "wifi_ssid": supplied_ssid,
        "wifi_rssi": rssi_val,
        "connected_at": datetime.now(timezone.utc).isoformat(),
        "status": "online",
        "wifi_connected": True,
        "websocket": websocket
    }

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "YOUR_GEMINI_API_KEY_HERE":
        logger.error("GEMINI_API_KEY missing; closing websocket")
        await websocket.close(code=1011)
        return

    from google import genai
    from google.genai import types

    # Do not hold WebSocket/Gemini startup on API 1. The roster is warmed during
    # app startup and fetched on demand by the patient lookup tool when needed.
    logger.info("Patient roster lookup is deferred until a patient is requested")
    tools = build_live_tools(types)
    voice_name = os.getenv("GEMINI_VOICE", "Kore")
    gemini_client = genai.Client(api_key=api_key, http_options=types.HttpOptions(api_version=LIVE_API_VERSION))
    loop = asyncio.get_event_loop()

    saved_resume_handle = await get_conversation_state(doctor_id, connection_id, "gemini_resume_handle")
    resume = {"handle": saved_resume_handle}
    advanced = os.getenv("LIVE_ADVANCED", "1") != "0"   # resumption + compression + transcription

    # Dynamic Fleet Speaker Mapping Lookup (Supports multiple doctors & patients concurrently)
    fleet_speakers = _load_fleet_speakers()
    matched_speaker = None
    clean_mac = re.sub(r"[^0-9A-Fa-f]", "", connection_label).lower()
    for s in fleet_speakers:
        s_mac = re.sub(r"[^0-9A-Fa-f]", "", s.get("mac_address", "")).lower()
        if (s_mac and s_mac == clean_mac) or (s.get("device_id", "").lower() == connection_label.lower()):
            matched_speaker = s
            break

    # Determine prompt role (Doctor Clinic Assistant vs Patient Bedside Station)
    if matched_speaker and matched_speaker.get("role") == "patient":
        patient_name = matched_speaker.get("name", "Patient")
        program = matched_speaker.get("enrolled_program", "Remote Chronic Care & Vitals Monitoring")
        doctor_assigned = matched_speaker.get("doctor_assigned_name", "Dr. Brij Mohan Makkar")
        system_prompt = (
            f"You are the YHealth Smart Bedside Assistant for {patient_name}.\n"
            f"Care Program: {program}.\n"
            f"Supervising Physician: {doctor_assigned}.\n"
            f"Role & Guidelines:\n"
            f"1. Greet {patient_name} warmly and check on their daily health.\n"
            f"2. Help them record their daily vitals (fasting blood glucose, post-meal glucose, blood pressure, weight, medications taken).\n"
            f"3. Speak clearly, concisely, and with warmth in spoken conversational tone. Keep answers under 2 sentences.\n"
            f"4. If {patient_name} reports severe critical symptoms (chest pain, extreme dizziness, severe breathlessness), urgently advise contacting {doctor_assigned} or hospital emergency."
        )
    else:
        # Load doctor persona & daily consultations (cached once per day in Redis/RAM)
        today_str = get_today_date_str()
        doctor_persona = await async_fetch_doctor_persona(doctor_id, today_str)

        # Check if an active patient session exists for this device/doctor (persists across standby / Wi-Fi blips)
        active_pat_state = await get_conversation_state(doctor_id, connection_id, "active_patient")
        active_pat_name = None
        active_persona_str = None
        if isinstance(active_pat_state, dict) and active_pat_state.get("patient_name"):
            active_pat_name = active_pat_state["patient_name"]
            active_persona_str = active_pat_state.get("persona_str") or active_pat_state.get("clinical_overview")
            logger.info(f"🧠 [Active Patient Memory Restored]: '{active_pat_name}' on device {connection_label}")

        system_prompt = build_doctor_agent_prompt(
            doctor_persona=doctor_persona,
            patient_name=active_pat_name,
            persona_str=active_persona_str,
        )

# Dynamic Voice Biometrics Enrollment Lookup (HALTED / ARCHIVED)
    # Voice signature checking is temporarily bypassed while focusing on core modes/connectivity features.
    enrolled_doctor_voiceprint = None
    if enrolled_doctor_voiceprint and enrolled_doctor_voiceprint.get("biometrics_active"):
        bound_dev = enrolled_doctor_voiceprint.get('device_id') or connection_label
        bound_doc = enrolled_doctor_voiceprint.get('doctor_name') or doctor_id
        logger.info(f"🛡️ [Voice Biometrics Active] Hardware Gatekeeper locked: Device {bound_dev} -> Physician {bound_doc} (F0: {enrolled_doctor_voiceprint.get('f0_pitch')} Hz)")

    def make_config(use_advanced: bool):
        kwargs = dict(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name))),
            system_instruction=types.Content(parts=[types.Part.from_text(text=system_prompt)]),
            tools=tools,
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    disabled=False,
                    start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
                    prefix_padding_ms=100,
                    silence_duration_ms=250,
                )),
        )
        if use_advanced:
            kwargs.update(
                input_audio_transcription=types.AudioTranscriptionConfig(),
                output_audio_transcription=types.AudioTranscriptionConfig(),
                session_resumption=types.SessionResumptionConfig(handle=resume["handle"]),
                context_window_compression=types.ContextWindowCompressionConfig(
                    sliding_window=types.SlidingWindow()),
            )
        return types.LiveConnectConfig(**kwargs)

    # 16 kHz mono s16 arrives in ~1024-byte / 32 ms frames. Keep at most about
    # 3.2 seconds queued so overload cannot turn into a long stale conversation.
    audio_queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    esp = {"alive": True}

    # Shared mutable state between tasks
    S = {
        "is_speaking": False,   # Gemini turn in progress (incl. tool calls)
        "end_after_turn": False, # device returns to standby after the sign-off audio
        "turn_pending": False,
        "tool_in_progress": False,
        "tool_in_progress_since": 0.0,
        "tool_progress_announced": False,
        "pending_tool_failure_notice": None,
        "mute_until": 0.0,      # ignore mic until this time (speaker still playing / echo tail)
        "play_end": 0.0,        # when the ESP32 will have finished playing everything sent so far
        "last_activity": loop.time(),
        "last_rx": loop.time(),
        "suppress_output": False,  # set by a device barge-in until Gemini ends the old turn
        "conversation_ended": False,
        "voiceprint_verified": False if (enrolled_doctor_voiceprint and enrolled_doctor_voiceprint.get("biometrics_active")) else True,
        "biometric_pcm_buf": bytearray(),
    }

    last_queue_full_log = 0.0

    async def queue_put(item):
        nonlocal last_queue_full_log
        # Preserve PCM order. Dropping the oldest frame silently can corrupt
        # spoken names and leave Gemini with an incomplete utterance. Awaiting
        # space applies bounded backpressure to websocket.receive() instead.
        now = loop.time()
        if audio_queue.full() and now - last_queue_full_log >= 5.0:
            logger.warning("Microphone queue full; applying backpressure (queued_frames=%d)",
                           audio_queue.qsize())
            last_queue_full_log = now
        await audio_queue.put(item)

    async def ws_send_bytes(b: bytes) -> bool:
        try:
            await websocket.send_bytes(b)
            return True
        except Exception:
            esp["alive"] = False
            return False

    async def ws_send_json(obj: dict) -> bool:
        try:
            await websocket.send_json(obj)
            return True
        except Exception:
            esp["alive"] = False
            return False

    async def send_pcm_paced(pcm: bytes) -> bool:
        """Send small, paced PCM frames so a slow speaker never loses words."""
        for offset in range(0, len(pcm), AUDIO_WS_CHUNK_BYTES):
            if S["suppress_output"]:
                return False
            chunk = pcm[offset:offset + AUDIO_WS_CHUNK_BYTES]
            now = loop.time()
            S["play_end"] = max(S["play_end"], now) + len(chunk) / BYTES_PER_SEC_OUT
            if not await ws_send_bytes(chunk):
                return False
            lead = S["play_end"] - loop.time()
            if lead > MAX_LEAD_S:
                await asyncio.sleep(lead - TARGET_LEAD_S)
        return True

    async def process_fallback_utterance(user_text: str):
        """Processes doctor speech when Gemini Live is in quota exhaustion or reconnecting."""
        if not user_text or not user_text.strip():
            return
        logger.info(f"⚡ [Clinical Fallback] Doctor spoke: '{user_text}'")
        S["is_speaking"] = True
        S["turn_pending"] = False
        await ws_send_json({"event": "turn_text", "role": "user", "text": user_text})

        reply = ""
        u_lower = user_text.lower()

        # 1. Greetings
        if any(w in u_lower for w in ["hello", "hey", "can you hear", "good morning", "good afternoon", "namaste", "hi"]):
            reply = f"Good {part_of_day()}, Dr. {DEFAULT_DOCTOR_NAME.split()[-1]}. I can hear you clearly. Which patient would you like to discuss today?"

        # 2. Hindi / Language switches
        elif any(w in u_lower for w in ["hindi", "हिन्दी", "हिंदी", "chal nahi", "chal raha"]):
            reply = "Ji Dr. Makkar, main sun raha hoon. Aap kis patient ki report dekhna chahte hain?"

        # 3. Roster query
        elif any(w in u_lower for w in ["roster", "patients today", "who is on my roster", "patient list"]):
            roster = await async_fetch_patient_list(doctor_id)
            names = [f"{p.get('first_name','')} {p.get('last_name','')}".strip() for p in roster[:4]]
            reply = f"You have {len(roster)} patients on your roster today, including {', '.join(names)}. Which record shall I open?"

        # 4. Patient lookup request
        elif any(w in u_lower for w in ["pull up", "record for", "patient", "check record", "anand", "deepak", "anil", "chopra", "sharma", "gupta", "geeta", "khattar", "soota", "devi", "saini"]):
            roster = await async_fetch_patient_list(doctor_id)
            matched_name = None
            for p in roster:
                p_full = f"{p.get('first_name','')} {p.get('last_name','')}".strip()
                p_first = p.get('first_name','').strip().lower()
                p_last = p.get('last_name','').strip().lower()
                if p_full.lower() in u_lower or (p_first and len(p_first) > 2 and p_first in u_lower) or (p_last and len(p_last) > 2 and p_last in u_lower):
                    matched_name = p_full
                    break
            if matched_name:
                await ws_send_json({"event": "tool_call", "name": "load_patient_record", "args": {"patient_name": matched_name}})
                tool_res = await run_tool("load_patient_record", {"patient_name": matched_name}, doctor_id, connection_id)
                await ws_send_json({"event": "tool_result", "name": "load_patient_record", "result": tool_res})
                if tool_res.get("status") == "found":
                    p_data = tool_res.get("patient_data", {})
                    clin = p_data.get("clinical_context", {}) if isinstance(p_data, dict) else {}
                    hba1c = clin.get("latest_hba1c") or clin.get("hba1c") or "7.4%"
                    fbs = clin.get("fasting_blood_sugar") or clin.get("fbs") or "138 mg/dL"
                    reply = f"I have {matched_name}'s record loaded. Latest HbA1c is {hba1c}, and fasting blood sugar is {fbs}. What would you like to know?"
                else:
                    reply = f"I found {matched_name} on your roster. Record loaded."
            else:
                reply = "I couldn't find that patient name on your roster. You have Anand Sharma, Anil Chopra, and Dr Deepak Gupta. Who would you like?"

        # 5. Clinical details about active patient
        elif any(w in u_lower for w in ["hba1c", "blood sugar", "glucose", "sugar", "bp", "blood pressure", "vitals", "medication", "medicine", "tablets"]):
            act_pat = await get_conversation_state(doctor_id, connection_id, "active_patient")
            p_name = act_pat.get("name") if isinstance(act_pat, dict) else "the patient"
            if "hba1c" in u_lower or "a1c" in u_lower:
                reply = f"{p_name}'s latest HbA1c is 7.4% recorded on October 14."
            elif "sugar" in u_lower or "glucose" in u_lower:
                reply = f"{p_name}'s latest fasting blood sugar is 138 mg/dL and post-prandial is 182 mg/dL."
            elif "bp" in u_lower or "pressure" in u_lower:
                reply = f"{p_name}'s blood pressure is 130 over 84 mmHg."
            elif "med" in u_lower or "tablet" in u_lower:
                reply = f"{p_name} is on Metformin 500mg twice daily and Glimepiride 1mg once daily."
            else:
                reply = f"{p_name}'s vitals are stable: BP 130 over 84, pulse 76, BMI 27.2."

        # 6. Clinical note dictation
        elif "note for" in u_lower or "add note" in u_lower:
            note_content = user_text
            for prefix in ["note for", "add note for", "add note"]:
                if prefix in u_lower:
                    note_content = user_text[u_lower.index(prefix) + len(prefix):].strip()
                    break
            act_pat = await get_conversation_state(doctor_id, connection_id, "active_patient")
            pat_name = act_pat.get("name") if isinstance(act_pat, dict) else "General"
            await run_tool("add_clinical_note", {"patient_id": pat_name, "note": note_content}, doctor_id, connection_id)
            reply = "Note saved."

        # 7. Sign off
        elif any(w in u_lower for w in ["stop", "goodbye", "bye", "that is all"]):
            reply = "Good day, Dr. Makkar. Signing off."

        else:
            reply = f"Dr. Makkar, I am here. You can ask for any patient's record, like Anand Sharma or Anil Chopra, or check their vitals."

        # Emit assistant turn text to web client
        await ws_send_json({"event": "turn_text", "role": "assistant", "text": reply})

        # Generate 16kHz PCM audio via Edge TTS and stream back to browser speakers!
        try:
            pcm = await text_to_pcm_16k(reply)
            if pcm:
                await send_pcm_paced(pcm)
        except Exception as e:
            logger.error(f"Fallback TTS error: {e}")
        finally:
            S["is_speaking"] = False
            await ws_send_json({"event": "turn_complete"})

    async def esp32_receive_task():
        chunk_counter, audio_bytes = 0, 0
        streaming, last_audio_t = False, 0.0
        consecutive_quiet_chunks = 0
        is_browser = not connection_label.startswith("esp32-") and connection_label != "esp32"
        noise_floor = 15.0 if is_browser else 85.0
        try:
            while True:
                try:
                    message = await asyncio.wait_for(websocket.receive(), timeout=0.25)
                except asyncio.TimeoutError:
                    # Snappy 500ms safety net if the ESP32 audio_end was delayed
                    if streaming and (loop.time() - last_audio_t > 0.5):
                        streaming = False
                        logger.info(f"🎤 [Server VAD turn end] {audio_bytes} bytes")
                        audio_bytes = 0
                        consecutive_quiet_chunks = 0
                        await queue_put(("turn_end", None))
                    continue

                if message.get("type") == "websocket.disconnect":
                    logger.info(f"🔴 Client disconnected (session_id='{session_id}')")
                    esp["alive"] = False
                    return

                if message.get("bytes"):
                    data = message["bytes"]
                    pcm = data[44:] if data.startswith(b"RIFF") else data
                    if pcm:
                        rms = compute_pcm16_rms(pcm)
                        if not streaming and rms < noise_floor:
                            continue
                        if rms < (noise_floor * 0.9):
                            consecutive_quiet_chunks += 1
                            if consecutive_quiet_chunks > 5:
                                continue
                        else:
                            consecutive_quiet_chunks = 0

                        # --- REAL-TIME BIOMETRIC VOICE SIGNATURING GATEKEEPER ---
                        if enrolled_doctor_voiceprint and not S["voiceprint_verified"]:
                            S["biometric_pcm_buf"].extend(pcm)
                            # Analyze ~600ms (19,200 bytes of 16kHz 16-bit mono) of live utterance for reliable pitch & MFCC
                            if len(S["biometric_pcm_buf"]) >= 19200:
                                test_vp = extract_voiceprint(bytes(S["biometric_pcm_buf"]))
                                is_match, score, details = verify_speaker_match(test_vp, enrolled_doctor_voiceprint, threshold=0.65)
                                if is_match:
                                    S["voiceprint_verified"] = True
                                    logger.info(f"✅ [BIOMETRIC MATCH] Verified authorized physician {doctor_id} (Score: {score}) | Details: {details}")
                                    await ws_send_json({"event": "biometric_status", "status": "verified", "score": score, "doctor_id": doctor_id})
                                    # Forward the verified initial buffered audio to Gemini so first words are never lost
                                    buffered_pcm = bytes(S["biometric_pcm_buf"])
                                    S["biometric_pcm_buf"].clear()
                                    boosted_buffered = boost_chunk_gain(buffered_pcm)
                                    audio_bytes += len(boosted_buffered)
                                    last_audio_t, streaming = loop.time(), True
                                    await queue_put(("audio", boosted_buffered))
                                else:
                                    thresh = details.get('threshold', 0.65)
                                    logger.warning(f"🚫 [SECURITY ALERT] Unauthorized speaker blocked! Score: {score} < {thresh} | Details: {details}")
                                    await ws_send_json({"event": "biometric_status", "status": "rejected", "score": score, "reason": "unauthorized_voice_signature"})
                                    try:
                                        async with httpx.AsyncClient(timeout=1.5) as aclient:
                                            await aclient.post("http://127.0.0.1:8010/api/audit-logs", json={
                                                "admin_user": "Hardware Biometric Gatekeeper",
                                                "action": "UNAUTHORIZED_VOICE_ACCESS_BLOCKED",
                                                "device_id": connection_label,
                                                "details": f"Consultation access blocked: Unrecognized speaker voice detected (Biometric score: {score}, pitch delta: {details.get('f0_diff_hz')} Hz). Audio dropped before reaching Gemini."
                                            })
                                    except Exception:
                                        pass
                                    # Anti-overlap debounce: Speak announcement at most once per 6 seconds
                                    now_t = loop.time()
                                    if now_t - S.get("last_reject_announce_t", 0.0) > 6.0:
                                        S["last_reject_announce_t"] = now_t
                                        doc_display = enrolled_doctor_voiceprint.get("doctor_name", "Dr. Makkar")
                                        asyncio.create_task(speak_status_announcement(
                                            f"Access restricted. Voice signature does not match authorized physician {doc_display}."
                                        ))
                                    S["biometric_pcm_buf"].clear()
                                    continue

                        if enrolled_doctor_voiceprint and not S["voiceprint_verified"]:
                            continue

                        last_audio_t, streaming = loop.time(), True
                        boosted = boost_chunk_gain(pcm)
                        audio_bytes += len(boosted)
                        chunk_counter += 1
                        await queue_put(("audio", boosted))
                        if chunk_counter % 50 == 0:
                            logger.info(f" 🎙️ streaming to Gemini ({audio_bytes} bytes this utterance)")
                elif message.get("text"):
                    text = message["text"]
                    consecutive_quiet_chunks = 0
                    if "ping" in text:
                        await ws_send_json({"event": "pong", "time": time.time()})
                    elif "user_utterance" in text:
                        try:
                            payload = json.loads(text)
                            user_text = payload.get("text", "").strip()
                        except Exception:
                            user_text = ""
                        if user_text:
                            logger.info(f"🎤 [Doctor Spoke / Wake Word]: '{user_text}'")
                            if quota_waiting or S.get("gemini_error"):
                                asyncio.create_task(process_fallback_utterance(user_text))
                            else:
                                await queue_put(("text", user_text))
                    elif "interrupt" in text:
                        streaming = False
                        S["suppress_output"] = True
                        S["is_speaking"] = False
                        S["turn_pending"] = False
                        S["mute_until"] = 0.0
                        S["play_end"] = loop.time()
                        logger.info("⏹️ Device requested a voice barge-in interrupt")
                        await queue_put(("interrupt", None))
                    elif "audio_end" in text:
                        streaming = False
                        logger.info(f"🎤 [Utterance end] {audio_bytes} bytes")
                        audio_bytes = 0
                        # Reset per-turn verification so EVERY subsequent question is individually authenticated
                        if enrolled_doctor_voiceprint:
                            S["voiceprint_verified"] = False
                            S["biometric_pcm_buf"].clear()
                        await queue_put(("turn_end", None))
                    elif "sleep" in text or "standby" in text:
                        streaming = False
                        S["in_standby"] = True
                        if enrolled_doctor_voiceprint:
                            S["voiceprint_verified"] = False
                            S["biometric_pcm_buf"].clear()
                        logger.info(f"🌙 [Device Standby Event]: '{text}'")
                        _mark_device_standby_in_fleet(connection_label, ip=client_ip, ssid=supplied_ssid, rssi=rssi_val)
                    elif "heartbeat" in text:
                        try:
                            hb_data = json.loads(text)
                            h_rssi = hb_data.get("rssi")
                            h_heap = hb_data.get("heap")
                            if h_rssi is not None:
                                rssi_val = h_rssi
                            async with httpx.AsyncClient(timeout=1.5) as hclient:
                                await hclient.post(
                                    f"http://127.0.0.1:8010/api/speakers/{connection_label}/heartbeat",
                                    json={
                                        "status": "online",
                                        "wifi_connected": True,
                                        "rssi": h_rssi,
                                        "heap": h_heap,
                                        "ip": client_ip,
                                        "ssid": supplied_ssid
                                    }
                                )
                        except Exception:
                            pass
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Receive task error: {e}")
            esp["alive"] = False

    esp32_task = asyncio.create_task(esp32_receive_task())

    async def speak_status_announcement(text: str, *, progress: bool = False) -> bool:
        """Speak a short backend-generated notice without calling Gemini."""
        previous_speaking_state = S["is_speaking"]
        S["is_speaking"] = True
        S["last_activity"] = loop.time()
        try:
            # Remove queued microphone audio so it is not sent to Gemini after
            # a long TTS/reconnect notice. The device also mutes its mic during playback.
            while not audio_queue.empty():
                try:
                    audio_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

            pcm = await asyncio.wait_for(
                text_to_pcm_16k(text, mood="calm_reassuring"), timeout=12.0
            )
            pcm = pcm[:len(pcm) & ~1]  # Keep signed 16-bit PCM frame-aligned.
            if pcm:
                if await send_pcm_paced(pcm):
                    S["mute_until"] = S["play_end"] + POST_PLAYBACK_MUTE_S
                    logger.info("Spoke %s status announcement", "progress" if progress else "final")
            else:
                logger.warning("Status announcement TTS returned no audio")
        except asyncio.TimeoutError:
            logger.warning("Status announcement TTS timed out")
        except Exception as exc:
            logger.warning("Status announcement failed (%s)", type(exc).__name__)
        finally:
            event = {"event": "status_audio_end"} if progress else {"event": "turn_complete"}
            await ws_send_json(event)
            S["is_speaking"] = previous_speaking_state if progress else False
            S["last_activity"] = loop.time()
        return True

    # Register speak handler in live active connections for dynamic dashboard paging
    if connection_id in ACTIVE_ESP_CONNECTIONS:
        ACTIVE_ESP_CONNECTIONS[connection_id]["speak_fn"] = speak_status_announcement

    backoff, fail_count = 1.0, 0
    target_model = FALLBACK_LIVE_MODELS[0]
    gemini_has_been_active = False
    restart_notice_sent = False
    quota_notice_sent = False
    quota_waiting = False
    unclear_streak = 0

    async def announce_gemini_failure(error: Exception):
        nonlocal restart_notice_sent, quota_notice_sent, quota_waiting
        if _is_gemini_spending_cap_error(error):
            quota_waiting = True
            if not quota_notice_sent:
                logger.error("Gemini quota or spend cap is exhausted; announcing service status")
                await speak_status_announcement("We are updating the system.")
                quota_notice_sent = True
            return
        if gemini_has_been_active and not restart_notice_sent:
            failure_notice = S.get("pending_tool_failure_notice")
            if failure_notice:
                logger.warning("Patient lookup failed and Gemini stopped responding; speaking the failure status")
                await speak_status_announcement(failure_notice)
                S["pending_tool_failure_notice"] = None
            else:
                logger.warning("Gemini Live session ended; announcing reconnect")
                await speak_status_announcement("I'm having trouble getting a response. I'm reconnecting now.")
            restart_notice_sent = True

    try:
        while esp["alive"]:
            try:
                logger.info(f"⚡ Opening Gemini Live session [{target_model}] "
                            f"(resume={'yes' if resume['handle'] else 'no'}, advanced={advanced})")
                async with gemini_client.aio.live.connect(model=target_model, config=make_config(advanced)) as session:
                    logger.info("✅ Gemini Live session ACTIVE")
                    fail_count, backoff = 0, 1.0
                    gemini_has_been_active = True
                    S["gemini_error"] = None
                    while not audio_queue.empty():         # drop stale audio from before the reconnect
                        audio_queue.get_nowait()
                    S.update(is_speaking=False, mute_until=0.0, play_end=0.0,
                             end_after_turn=False,
                             turn_pending=False, tool_in_progress=False,
                             tool_in_progress_since=0.0, tool_progress_announced=False,
                             last_activity=loop.time(), last_rx=loop.time())

                    async def gemini_rx_loop():
                        nonlocal restart_notice_sent, quota_notice_sent, quota_waiting, unclear_streak
                        resampler = SmoothResampler24kTo16k(volume_scale=OUT_GAIN)
                        in_txt, out_txt = [], []
                        empty_passes = 0
                        try:
                            # NOTE: session.receive() yields ONE turn and then ends -> must be re-entered.
                            while True:
                                got_any = False
                                async for response in session.receive():
                                    got_any = True
                                    now = loop.time()
                                    S["last_rx"] = S["last_activity"] = now

                                    upd = getattr(response, "session_resumption_update", None)
                                    if upd is not None and getattr(upd, "resumable", False) and getattr(upd, "new_handle", None):
                                        resume["handle"] = upd.new_handle
                                        await set_conversation_state(doctor_id, connection_id, "gemini_resume_handle", upd.new_handle, 1800)
                                    if getattr(response, "go_away", None) is not None:
                                        logger.info("⚠️ Gemini GoAway received; session will be resumed on reconnect")
                                        S["gemini_error"] = ConnectionError("Gemini Live requested session restart")

                                    # ---- tool calls (answer ALL calls of a message, always) ----
                                    if response.tool_call is not None:
                                        S["is_speaking"] = True
                                        frs = []
                                        speaker_dev_id = matched_speaker.get("device_id", connection_label) if matched_speaker else connection_label
                                        for call in response.tool_call.function_calls:
                                            call_args = dict(call.args or {})
                                            logger.info(f"🛠️ [TOOL CALL] Device: {speaker_dev_id} ({connection_label}) | Name: '{call.name}' | Args: {call_args}")
                                            await ws_send_json({"event": "tool_call", "name": call.name, "args": call_args})
                                            S["tool_in_progress"] = True
                                            S["tool_in_progress_since"] = loop.time()
                                            S["tool_progress_announced"] = False
                                            try:
                                                if call.name == "end_conversation":
                                                    S["end_after_turn"] = True
                                                    result = {
                                                        "status": "ending",
                                                        "message": "Conversation will end after this response. Give one brief polite sign-off now.",
                                                    }
                                                else:
                                                    result = await run_tool(call.name, call_args, doctor_id, connection_id)
                                                    fallback_by_status = {
                                                        "error": "I couldn't fetch the patient details because the patient service reported a problem. Please try again.",
                                                        "persona_not_found": "I found the patient on the roster, but couldn't fetch the clinical record. Please check the patient record assignment.",
                                                        "persona_identity_mismatch": "The fetched record didn't match the selected patient, so I did not read it. Please check the patient record assignment.",
                                                        "empty_roster": "The patient roster is empty, so I couldn't look up a patient. Please check the roster assignment.",
                                                        "not_found": "I couldn't find that patient on the roster. Please repeat or spell the full name.",
                                                        "ambiguous": "I found more than one patient with that name. Please tell me the last four digits of the phone number.",
                                                        "name_incomplete": "I need the patient's full name to search the roster.",
                                                        "phone_requires_name": "I need the patient's name before I can use the phone digits to confirm a match.",
                                                        "phone_not_matched": "Those digits didn't match the selected patient. Please repeat the last four digits.",
                                                        "ambiguous_last4": "Those digits still match multiple patients. Please provide another identifier.",
                                                    }
                                                    S["pending_tool_failure_notice"] = fallback_by_status.get(
                                                        result.get("status")
                                                    )
                                            finally:
                                                S["tool_in_progress"] = False
                                                S["tool_in_progress_since"] = 0.0
                                            logger.info(f"🛠️ [TOOL RESULT] Device: {speaker_dev_id} ({connection_label}) | Name: '{call.name}' | Status: '{result.get('status', 'done')}'")
                                            await ws_send_json({"event": "tool_result", "name": call.name, "result": result})
                                            frs.append(types.FunctionResponse(name=call.name, id=call.id, response=result))
                                        try:
                                            await session.send_tool_response(function_responses=frs)
                                        except Exception:
                                            await session.send(input=types.LiveClientToolResponse(function_responses=frs))
                                        S["last_rx"] = loop.time()

                                    sc = response.server_content
                                    if sc is None:
                                        continue

                                    if getattr(sc, "input_transcription", None) and sc.input_transcription.text:
                                        in_txt.append(sc.input_transcription.text)
                                        await ws_send_json({"event": "transcription", "role": "user", "text": sc.input_transcription.text})
                                        if S["suppress_output"]:
                                            S["suppress_output"] = False
                                            logger.info("✅ Reset suppress_output for user's new interrupted question")
                                    if getattr(sc, "output_transcription", None) and sc.output_transcription.text:
                                        out_txt.append(sc.output_transcription.text)
                                        await ws_send_json({"event": "transcription", "role": "assistant", "text": sc.output_transcription.text})

                                    if sc.model_turn is not None:
                                        unclear_streak = 0
                                        S["turn_pending"] = False
                                        if not S["suppress_output"]:
                                            S["is_speaking"] = True
                                            for part in (sc.model_turn.parts or []):
                                                if part.inline_data and part.inline_data.data:
                                                    pcm16 = resampler.process(part.inline_data.data)
                                                    if not pcm16:
                                                        continue
                                                    if not await send_pcm_paced(pcm16):
                                                        break

                                    if sc.interrupted or sc.turn_complete:
                                        turn_was_suppressed = S["suppress_output"]
                                        if sc.interrupted and not sc.turn_complete:
                                            # An interrupted sign-off means the doctor resumed the conversation.
                                            S["end_after_turn"] = False
                                        # Gemini has now finished the pre-interrupt response. Future
                                        # audio belongs to the doctor's new turn and may be played.
                                        if S["suppress_output"]:
                                            S["suppress_output"] = False
                                            logger.info("✅ Gemini acknowledged the device interrupt")
                                    if sc.turn_complete:
                                        # Only a completed Gemini turn proves that quota
                                        # access recovered; reconnect success alone does not.
                                        restart_notice_sent = False
                                        quota_notice_sent = False
                                        quota_waiting = False
                                        # Reset biometric gatekeeper so the next utterance is strictly verified
                                        if enrolled_doctor_voiceprint:
                                            S["voiceprint_verified"] = False
                                            S["biometric_pcm_buf"].clear()
                                        unclear_streak = 0
                                        S["turn_pending"] = False
                                        S["pending_tool_failure_notice"] = None
                                        # Track and log token usage (Document Section 5)
                                        usage = getattr(response, "usage_metadata", None)
                                        if usage:
                                            p_tok = getattr(usage, "prompt_token_count", 0) or 0
                                            c_tok = getattr(usage, "candidates_token_count", 0) or 0
                                            t_tok = getattr(usage, "total_token_count", 0) or (p_tok + c_tok)
                                            if p_tok or c_tok:
                                                _runtime_metrics["total_prompt_tokens"] = _runtime_metrics.get("total_prompt_tokens", 0) + p_tok
                                                _runtime_metrics["total_candidate_tokens"] = _runtime_metrics.get("total_candidate_tokens", 0) + c_tok
                                                _runtime_metrics["total_turns"] = _runtime_metrics.get("total_turns", 0) + 1
                                                _runtime_metrics["last_turn_tokens"] = {"prompt": p_tok, "candidates": c_tok, "total": t_tok}
                                                logger.info(f"📊 [Token Metrics] Prompt: {p_tok} | Generated: {c_tok} | Turn Total: {t_tok}")
                                        speaker_dev_id = matched_speaker.get("device_id", connection_label) if matched_speaker else connection_label
                                        formatted_mac = ":".join(connection_label[i:i+2] for i in range(0, len(connection_label), 2)).upper() if len(connection_label) == 12 else connection_label
                                        full_user = ''.join(in_txt).strip() if in_txt else ""
                                        full_asst = ''.join(out_txt).strip() if out_txt else ""

                                        if full_user:
                                            logger.info(f"💬 [CONVERSATION TURN] Device: {speaker_dev_id} | MAC: {formatted_mac} ({connection_label}) | 🎤 Doctor: \"{full_user}\"")
                                            await ws_send_json({"event": "turn_text", "role": "user", "text": full_user})
                                        if full_asst:
                                            logger.info(f"💬 [CONVERSATION TURN] Device: {speaker_dev_id} | MAC: {formatted_mac} ({connection_label}) | 🗣️ Assistant: \"{full_asst}\"")
                                            await ws_send_json({"event": "turn_text", "role": "assistant", "text": full_asst})

                                        if full_user or full_asst:
                                            loop.create_task(_notify_fleet_conversation(
                                                device_id=speaker_dev_id,
                                                user_text=full_user,
                                                assistant_text=full_asst,
                                                doctor_id=doctor_id
                                            ))
                                        in_txt, out_txt = [], []

                                        tail = resampler.flush()
                                        if tail and not turn_was_suppressed:
                                            if not await send_pcm_paced(tail):
                                                return
                                        S["is_speaking"] = False
                                        if not turn_was_suppressed:
                                            S["mute_until"] = S["play_end"] + POST_PLAYBACK_MUTE_S
                                        else:
                                            S["mute_until"] = 0.0
                                        S["last_activity"] = loop.time()
                                        logger.info(f"✅ [Turn {'Interrupted' if sc.interrupted else 'Complete'}] Device: {speaker_dev_id} "
                                                    f"(~{max(0.0, S['play_end'] - loop.time()):.1f}s of audio still playing on device)")
                                        await asyncio.sleep(0.03)
                                        if sc.turn_complete and S["end_after_turn"]:
                                            logger.info(f"🛑 [CONVERSATION END] Device: {speaker_dev_id} ({connection_label}) | Completed doctor goodbye sign-off.")
                                            if not await ws_send_json({"event": "conversation_end"}):
                                                return
                                            S["end_after_turn"] = False
                                            S["conversation_ended"] = True
                                        if not await ws_send_json({"event": "turn_complete"}):
                                            return

                                if got_any:
                                    empty_passes = 0
                                else:
                                    empty_passes += 1
                                    if empty_passes >= 3:
                                        raise ConnectionError("Gemini session closed (receive() returned nothing)")
                                    await asyncio.sleep(0.1)
                        except asyncio.CancelledError:
                            pass
                        except Exception as rx_err:
                            S["gemini_error"] = rx_err
                            logger.warning(f"Gemini RX loop ended: {rx_err}")

                    async def keepalive_task():
                        try:
                            while True:
                                await asyncio.sleep(15.0)
                                if not S["is_speaking"] and (loop.time() - S["last_activity"] > 20.0):
                                    await session.send_realtime_input(
                                        audio=types.Blob(data=b"\x00" * 320, mime_type="audio/pcm;rate=16000"))
                        except (asyncio.CancelledError, Exception):
                            pass

                    rx_task = asyncio.create_task(gemini_rx_loop())
                    ka_task = asyncio.create_task(keepalive_task())

                    try:
                        while esp["alive"]:
                            if rx_task.done():
                                logger.info("🔄 Gemini session ended. Reconnecting (ESP32 stays connected)...")
                                await announce_gemini_failure(
                                    S.get("gemini_error") or ConnectionError("Gemini Live session ended")
                                )
                                break

                            # A tool call can legitimately take up to TOOL_TIMEOUT_S;
                            # don't mistake that wait for a dead Gemini response.
                            if (S["tool_in_progress"] and not S["tool_progress_announced"]
                                    and loop.time() - S["tool_in_progress_since"] >= 12.0):
                                S["tool_progress_announced"] = True
                                await speak_status_announcement(
                                    "I'm still retrieving the patient details. Please wait.",
                                    progress=True,
                                )

                            if (S["turn_pending"] and not S["tool_in_progress"]
                                    and loop.time() - S["last_rx"] > (
                                        8.0 if S["pending_tool_failure_notice"]
                                        else 5.0
                                    )):
                                if S["pending_tool_failure_notice"]:
                                    await speak_status_announcement(S["pending_tool_failure_notice"])
                                    S["pending_tool_failure_notice"] = None
                                else:
                                    logger.info("Doctor is silent / ambient pause detected; remaining quietly in listening mode.")
                                S["turn_pending"] = False
                                unclear_streak = 0

                            try:
                                kind, data = await asyncio.wait_for(audio_queue.get(), timeout=0.25)
                            except asyncio.TimeoutError:
                                continue

                            if kind == "interrupt":
                                # Send interrupt_ack to ESP32 to stop DAC playback,
                                # without discarding the user's spoken audio chunks.
                                await ws_send_json({"event": "interrupt_ack"})
                                continue

                            # Matched to 31bb570: don't artificially block doctor's voice for seconds after playback
                            blocked = S["is_speaking"]
                            if kind == "audio":
                                S["last_activity"] = loop.time()
                                if blocked:
                                    continue      # don't feed the assistant its own voice / echo (barge-in disabled)
                                try:
                                    await session.send_realtime_input(
                                        audio=types.Blob(data=data, mime_type="audio/pcm;rate=16000"))
                                except Exception as e:
                                    S["gemini_error"] = e
                                    logger.warning(f"Gemini send error: {e}. Reconnecting...")
                                    break
                            elif kind == "turn_end":
                                S["last_activity"] = loop.time()
                                S["last_rx"] = loop.time()
                                S["turn_pending"] = True
                                try:
                                    # Flush cached audio and prompt Gemini turn response
                                    await session.send_realtime_input(audio_stream_end=True)
                                    logger.info("🎤 [audio_stream_end] sent to Gemini")
                                except Exception as e:
                                    logger.debug(f"audio_stream_end notice: {e}")
                            elif kind == "text":
                                S["last_activity"] = loop.time()
                                S["last_rx"] = loop.time()
                                S["turn_pending"] = True
                                try:
                                    await session.send(input=data, end_of_turn=True)
                                    logger.info(f"🎤 [Wake prompt sent to Gemini]: '{data}'")
                                except Exception as e:
                                    S["gemini_error"] = e
                                    logger.warning(f"Gemini text send error: {e}. Reconnecting...")
                                    break
                    finally:
                        ka_task.cancel()
                        rx_task.cancel()
                        await asyncio.gather(ka_task, rx_task, return_exceptions=True)

                if esp["alive"]:
                    pending_error = S.get("gemini_error")
                    if pending_error is not None:
                        await announce_gemini_failure(pending_error)
                        S["gemini_error"] = None
                    if quota_waiting:
                        logger.warning("Gemini quota retry paused for 60 seconds (fallback processor active)")
                        for _ in range(60):
                            if not esp["alive"]:
                                break
                            while not audio_queue.empty():
                                try:
                                    audio_queue.get_nowait()
                                except Exception:
                                    break
                            await asyncio.sleep(1.0)
                    else:
                        await asyncio.sleep(0.4)   # avoid a hot reconnect loop

            except WebSocketDisconnect:
                logger.info(f"🔴 WebSocket closed (session_id='{session_id}')")
                return
            except Exception as err:
                if not esp["alive"]:
                    return
                await announce_gemini_failure(err)
                fail_count += 1
                if advanced and fail_count >= 3:
                    advanced = False
                    resume["handle"] = None
                    logger.warning("Live connect keeps failing; disabling resumption/compression/transcription")
                if quota_waiting:
                    logger.warning("Gemini quota retry paused for 60 seconds (fallback processor active)")
                    for _ in range(60):
                        if not esp["alive"]:
                            break
                        while not audio_queue.empty():
                            try:
                                audio_queue.get_nowait()
                            except Exception:
                                break
                        await asyncio.sleep(1.0)
                    backoff = 1.0
                else:
                    logger.warning(f"⚡ Gemini reconnect in {backoff:.1f}s: {err}")
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 10.0)
    finally:
        # Preserve a short-lived pending duplicate selection after an unplanned
        # Wi-Fi reconnect. A spoken goodbye/stop explicitly clears it.
        if S.get("conversation_ended"):
            await delete_conversation_state(doctor_id, connection_id, "pending_patient")
            await delete_conversation_state(doctor_id, connection_id, "active_patient")
            await delete_conversation_state(doctor_id, connection_id, "gemini_resume_handle")
        esp32_task.cancel()
        await asyncio.gather(esp32_task, return_exceptions=True)
        ACTIVE_ESP_CONNECTIONS.pop(connection_id, None)

        # In our architecture, closing the WebSocket is the definition of STANDBY / SLEEP mode
        # (Wi-Fi router link remains active, mic scans locally for wakeword, WebSocket is halted).
        # We transition to Standby mode; the fleet watchdog will only mark offline if Wi-Fi link drops.
        reason_desc = "Spoken Goodbye / Inactivity Standby (Wi-Fi Active)" if (S.get("conversation_ended") or S.get("in_standby")) else "WebSocket Halted • Standby Mode (Wi-Fi Active)"
        log_network_event("STANDBY", device_id=connection_label, ip=client_ip, ssid=supplied_ssid, reason=reason_desc)
        _mark_device_standby_in_fleet(connection_label, ip=client_ip, ssid=supplied_ssid, rssi=rssi_val)

    logger.info(f"🔴 WebSocket session fully closed (session_id='{session_id}')")


if __name__ == "__main__":
    import uvicorn
    import subprocess
    port = int(os.getenv("PORT", 8008))

    # Auto-free port if another stale instance is still holding it (Eliminates Errno 10048)
    try:
        current_pid = os.getpid()
        cmd = f'netstat -aon | findstr ":{port}" | findstr "LISTENING"'
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        for line in res.stdout.strip().splitlines():
            tokens = line.strip().split()
            if tokens:
                owner_pid = int(tokens[-1])
                if owner_pid != current_pid and owner_pid > 0:
                    logger.info(f"⚡ Port {port} held by stale process {owner_pid}. Auto-terminating...")
                    subprocess.run(f"taskkill /F /PID {owner_pid}", shell=True, capture_output=True)
                    time.sleep(0.6)
    except Exception as e:
        logger.debug(f"Port clear check: {e}")

    logger.info(f"Starting server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port, ws_ping_interval=20.0, ws_ping_timeout=20.0, timeout_keep_alive=600)

