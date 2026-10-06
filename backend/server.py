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
from datetime import datetime
from contextlib import asynccontextmanager

import httpx
import edge_tts
import miniaudio
from dotenv import load_dotenv
try:
    from redis.asyncio import Redis as AsyncRedis
except ImportError:  # Allows the backend to start before the Redis extra is installed.
    AsyncRedis = None
from fastapi import FastAPI, Request, Response, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("gemini-backend")

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
# Set doctor IDs in backend/.env; no account-specific ID is shipped as a default.
PATIENTS_API_BASE_URL = os.getenv("PATIENTS_API_BASE_URL", "http://200.97.162.162:8000/agent/patients")
DEFAULT_DOCTOR_ID = os.getenv("DEFAULT_DOCTOR_ID", "")
PATIENTS_API_DOCTOR_ID = os.getenv("PATIENTS_API_DOCTOR_ID", "")
_DOCTOR_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PERSONA_API_BASE_URL = os.getenv("PERSONA_API_BASE_URL", "http://200.97.162.162:8000/persona-hardware")
PERSONA_HARDWARE_TOKEN = os.getenv("PERSONA_HARDWARE_TOKEN", "")

# Audio / pacing (ESP32 plays 16kHz mono s16 => 32000 bytes/s)
BYTES_PER_SEC_OUT = 32000.0
OUT_GAIN = float(os.getenv("GEMINI_OUT_GAIN", "0.46"))       # applied while resampling 24k->16k
IN_GAIN = float(os.getenv("GEMINI_IN_GAIN", "1.4"))          # mic boost
MAX_LEAD_S = float(os.getenv("PLAYBACK_MAX_LEAD_S", "0.6"))  # keep extra headroom in the 2 s ESP playback ring
TARGET_LEAD_S = float(os.getenv("PLAYBACK_TARGET_LEAD_S", "0.3"))
POST_PLAYBACK_MUTE_S = 0.6                                   # ignore mic this long after the speaker finishes

CACHE_TTL_ROSTER_S = 600
CACHE_TTL_PERSONA_S = 300
MAX_TOOL_RECORD_CHARS = 20000
API1_REQUEST_TIMEOUT_S = float(os.getenv("API1_REQUEST_TIMEOUT_S", "35.0"))
API2_REQUEST_TIMEOUT_S = float(os.getenv("API2_REQUEST_TIMEOUT_S", "8.0"))
TOOL_TIMEOUT_S = float(os.getenv("PATIENT_LOOKUP_TIMEOUT_S", "45.0"))
GEMINI_NO_PROGRESS_TIMEOUT_S = float(os.getenv("GEMINI_NO_PROGRESS_TIMEOUT_S", "20.0"))
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
_session_state_fallback = {}
_clinical_notes = {}
_escalated_alerts = {}


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
            socket_connect_timeout=0.4, socket_timeout=0.6,
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
    try:
        raw = await client.get(key)
        return json.loads(raw) if raw else None
    except Exception as exc:
        _warn_redis_once(f"Redis is unavailable; using the in-memory cache fallback ({type(exc).__name__}).")
        return None


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


@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "ESP32 Gemini Voice Relay",
        "configured_model": FALLBACK_LIVE_MODELS[0],
    }


# ==========================================================
# PERSONA HELPERS
# ==========================================================
_DROP_KEYS = {
    "_meta", "persona_id", "patient_id", "mongo_patient_id", "token", "auth_token",
    "jwt", "url", "image_url", "report_url", "pdf_url", "avatar",
}
_URL_RE = re.compile(r"https?://\S+|www\.\S+|s3://\S+")
_JWT_RE = re.compile(r"eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+")


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
    """Full cleaned record for the model (so it can answer ANY question), summary only if huge."""
    cleaned = clean_persona_dict(p_data)
    try:
        if len(json.dumps(cleaned, ensure_ascii=False)) <= MAX_TOOL_RECORD_CHARS:
            return cleaned
    except Exception:
        pass
    s = summarize_persona_for_tool_response(p_data)
    if isinstance(s, dict):
        s["note"] = "Record was too large; this is a summary."
    return s


# ==========================================================
# PROMPT
# ==========================================================
def part_of_day() -> str:
    try:
        from zoneinfo import ZoneInfo
        h = datetime.now(ZoneInfo(os.getenv("TZ_NAME", "Asia/Kolkata"))).hour
    except Exception:
        h = datetime.now().hour
    return "morning" if h < 12 else "afternoon" if h < 17 else "evening"


def build_doctor_agent_prompt(
    doctor_name: str = "Samarth",
    specialization: str = "Endocrinologist",
    patient_name: str = None,
    persona_str: str = None,
) -> str:
    tod = part_of_day()

    answer_rules = (
        "   - Answer directly from the PATIENT PERSONA RECORD. Cite the actual number, date, or "
        "name — never a rounded or invented approximation.\n"
        "   - Keep it concise: 1-3 complete sentences, unless the doctor asks for a fuller summary.\n"
        "   - If the record does not contain the answer, say so plainly: 'That is not in the current "
        "record.' Never fill the gap with a guess.\n"
        "   - If a value falls in an emergency range (glucose below 54 or above 350 mg/dL, systolic BP "
        "above 180, diastolic above 120), lead with that flag before anything else, in a clear and "
        "direct — not alarmed — tone.\n"
        "   - Offer interpretation as data-grounded observation, not diagnosis: describe what the "
        "readings show and how they compare to target, and let the doctor draw the conclusion.\n"
    )

    if patient_name and persona_str:
        patient_block = (
            f"ACTIVE PATIENT: {patient_name}\n"
            "A patient record is currently loaded. Answer clinical questions using ONLY the data "
            "below. Do not invent, estimate, or assume any value not present in this record.\n\n"
            "PATIENT PERSONA RECORD:\n"
            f"{persona_str}\n"
        )
        patient_state_rule = "3. THE DOCTOR ASKS ABOUT THE ACTIVE PATIENT (vitals, glucose, HbA1c, BP, weight, medications, adherence, labs, diet, notes, appointments, anything clinical):\n" + answer_rules
    else:
        patient_block = (
            "ACTIVE PATIENT: none loaded yet.\n"
            "Records are loaded on demand with the load_patient_record tool. The tool result contains "
            "the full record in the field 'patient_data'. Once a tool result has status 'found', that "
            "patient_data IS the PATIENT PERSONA RECORD referred to in these rules, and it stays valid "
            "until the doctor names a different patient.\n"
        )
        patient_state_rule = (
            "3. CLINICAL QUESTIONS (vitals, glucose, HbA1c, BP, weight, medications, adherence, labs, "
            "diet, notes, appointments, anything clinical):\n"
            "   - If no patient has been loaded yet, ask once, briefly: 'Which patient would you like "
            "to discuss?' Do not guess who they mean.\n"
            "   - Once a patient is loaded, use patient_data from the most recent 'found' tool result.\n"
            + answer_rules
        )

    return (
        "STRICT HUMAN VOICE INTELLIGENCE & CLINICAL ASSISTANT INSTRUCTIONS:\n"
        f"You are YHealth Assist, a clinical AI coordinator speaking directly with Dr. {doctor_name}, "
        f"{specialization}. You support the doctor's clinical workflow by retrieving and discussing "
        "patient records, hands-free, during their consultations.\n"
        "SPEAKING STYLE: Speak at a calm, natural, measured pace — like a composed colleague, never "
        "rushed. Pause briefly between sentences. Always finish every sentence completely; never trail "
        "off or cut yourself short. Keep answers brief but complete. No shouting or abrupt tone changes.\n"
        "CRITICAL VOICE & URL FORMATTING RULE: You are speaking over a live voice connection. Speak "
        "strictly in natural, conversational spoken English. NEVER read out, spell out, or mention any "
        "URLs, links, domain names, file extensions, raw JSON syntax, slashes, or raw ratios. Always "
        "translate numbers and dates into natural spoken words (e.g. '2000 calories', 'July 5th, 1995').\n"
        "CRITICAL: Never append boilerplate or disclaimers (e.g. 'please verify independently', 'this "
        "is not medical advice') to routine answers. The doctor is the licensed clinician — give "
        "direct, grounded answers only.\n\n"

        "CONVERSATION RULES:\n"
        "1. WHEN THE DOCTOR CALLS YOUR WAKE WORD ('Hello Assistant', 'Hey Assistant', 'Hey YHealth', "
        "'Hello YHealth Assist') OR GREETS YOU:\n"
        f"   - Reply with ONE short sentence: greet Dr. {doctor_name} by name and ask which patient "
        f"to start with, e.g. 'Good {tod}, Dr. {doctor_name}. Which patient would you like to start with?'\n"
        "   - If a patient is already loaded, offer to continue with that patient or switch.\n"
        "   - Do not list capabilities unless asked.\n"
        "2. WHEN THE DOCTOR STATES OR SWITCHES A PATIENT NAME OR EXACT PATIENT ID "
        "(at session start, or mid-conversation):\n"
        "   - Call load_patient_record with the spoken name or exact ID immediately. Do not search by phone alone. Do not answer clinical "
        "questions from a prior patient once a new name has been stated.\n"
        "   - Say ONE brief holding line while it runs: 'One moment, pulling up that record.'\n"
        "   - When the tool returns status 'found': confirm the matched full name in one short "
        "sentence and ask what the doctor would like to know, e.g. 'I have Priya Sharma's record. "
        "What would you like to know?'\n"
        "   - When status is 'ambiguous': say there are multiple patients with that name and ask the doctor to confirm the last four digits of the phone number. Do not ask them to pick a candidate name. Do not speak or reveal any phone digits.\n"
        "   - If the doctor says a name and its phone ending together, pass the whole phrase to load_patient_record so the backend can check both in one turn. If only four digits are spoken while a duplicate choice is pending, call confirm_patient_by_phone_last4.\n"
        "   - After the doctor says the four digits, call confirm_patient_by_phone_last4 with exactly those four digits. Do not call load_patient_record again for that pending choice. If a unique patient is confirmed, confirm the matched name and continue. If it does not match, ask the doctor to repeat the last four digits.\n"
        "   - When status is 'not_found': say you couldn't find that patient and ask the doctor to "
        "repeat or spell the name. Never fabricate a record.\n"
        "   - When status is 'name_incomplete': ask for the patient's full name; use phone digits only if the full name matches multiple roster entries.\n"
        "   - When status is 'phone_requires_name': ask for the patient's name first. Never use a phone number as a general patient search.\n"
        "   - When status is 'persona_not_found': clarify that the patient matched API 1 but API 2 returned no persona for that roster ID; ask for the API 2 patient assignment to be checked. Do not claim the roster match failed.\n"
        "   - When status is 'persona_identity_mismatch': say the patient record link is inconsistent and do not read or summarize any returned clinical data.\n"
        "   - Use an exact roster name match. Never substitute a similarly-spelled name or another patient's record.\n"
        "   - When status is 'empty_roster': say the doctor roster currently has no patients available "
        "and ask for the roster assignment to be checked. Do not claim that the named patient does not exist.\n"
        "   - When status is 'error': say the record lookup failed and offer to try again. Do NOT claim "
        "the patient does not exist.\n"
        f"{patient_state_rule}"
        "4. WHEN THE DOCTOR DICTATES A CLINICAL NOTE (e.g. 'note for [patient]: increase walking to "
        "45 minutes daily'):\n"
        "   - Repeat the note content back once for confirmation before calling add_clinical_note.\n"
        "   - After the tool confirms, say: 'Note saved.' Nothing more.\n"
        "5. WHEN THE DOCTOR ASKS TO SEND AN ALERT OR NOTIFY A PATIENT:\n"
        "   - Confirm the patient and alert type, then call escalate_alert.\n"
        "   - After the tool confirms, say: 'Alert sent to patient.' Nothing more.\n"
        "6. WHEN THE DOCTOR GIVES A STANDALONE SIGN-OFF COMMAND ('STOP', 'GOODBYE', 'BYE', 'THAT IS ALL', OR 'GO TO SLEEP'), not when 'stop' is part of a clinical instruction:\n"
        "   - Call end_conversation immediately, then give one brief sign-off and stop speaking.\n\n"

        "CLINICAL SAFETY RULES — ABSOLUTE:\n"
        "- Every number, date, or name you speak must come from the PATIENT PERSONA RECORD. Never "
        "estimate, round beyond what is given, or infer a value that is not present.\n"
        "- Never suggest a specific medication dosage change, substitution, or discontinuation — that "
        "decision belongs to the doctor. You may state what the record shows but not what to prescribe.\n"
        "- Never state a diagnosis as settled fact. Describe what the data shows versus target ranges.\n"
        "- If asked something outside the patient's record or your role, say plainly that it's outside "
        "what you can confirm from this record.\n\n"

        "DOCTOR CONTEXT:\n"
        f"Name: Dr. {doctor_name}\n"
        f"Specialization: {specialization}\n\n"
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
    try:
        client = get_http_client()
        resp = await client.get(
            f"{PATIENTS_API_BASE_URL}/{doctor_id}",
            headers={"accept": "application/json"},
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
            logger.warning(f"⚠️ API 1 returned status {resp.status_code} for doctor {doctor_id}")
    except Exception as e:
        _roster_status_by_doctor[doctor_id] = "stale" if stale else "unavailable"
        logger.warning(
            "API 1 roster request failed after %.1fs (%s); %s",
            time.perf_counter() - api1_started,
            type(e).__name__,
            "using the still-valid cached roster" if stale else "no usable cached roster is available",
        )
    finally:
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
    """Fetch/cache only a non-empty persona whose identity matches its API 1 row."""
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

    try:
        client = get_http_client()
        headers = {"accept": "*/*"}
        if PERSONA_HARDWARE_TOKEN:
            headers["x-hardware-token"] = PERSONA_HARDWARE_TOKEN
        resp = await client.get(
            f"{PERSONA_API_BASE_URL}/{patient_id}",
            headers=headers,
            timeout=httpx.Timeout(API2_REQUEST_TIMEOUT_S, connect=3.0),
        )
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
    except Exception as e:
        _persona_status_by_id[cache_id] = "error"
        logger.warning(f"⚠️ API 2 fetch error: {type(e).__name__}")
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
    """Match exact patient IDs or exact name tokens; phones are duplicate-only."""
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

    # IDs must match exactly; a phone number is deliberately not a general search key.
    chosen = [r for r in rows if len(query_id) >= 6 and query_id in r[5]]
    if not chosen:
        if not q:
            return []
        q_tokens = set(q.split())
        full_exact = [r for r in rows if r[1] == q]
        # Prefer a full-name exact match. Otherwise allow exact spoken name tokens
        # in any order (e.g. first name only), never substring/fuzzy lookalikes.
        chosen = full_exact or [r for r in rows if q_tokens and q_tokens.issubset(r[2])]

    seen, out = set(), []
    for r in chosen:
        key = r[4] or f"{r[1]}:{id(r[0])}"
        if key not in seen:
            seen.add(key)
            out.append(r[0])
    return out


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
    await set_conversation_state(doctor_id, connection_id, "active_patient",
                                 {"patient_id": row_id, "persona_id": resolved_id,
                                  "patient_name": full}, REDIS_SESSION_TTL_S)
    logger.info("API 2 persona loaded and identity-verified for the uniquely matched roster patient")
    return {"status": "found", "matched_patient": full, "patient_data": build_tool_patient_data(persona)}


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
    await delete_conversation_state(session_doctor_id, connection_id, "active_patient")
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
            pn, nc = args.get("patient_name", ""), args.get("note_content", "")
            logger.info(f"📝 add_clinical_note: '{pn}' -> '{nc}'")
            _clinical_notes.setdefault(pn, []).append(nc)
            return {"status": "success", "message": f"Note saved for {pn}."}
        if fn == "escalate_alert":
            pn, at = args.get("patient_name", ""), args.get("alert_type", "")
            logger.info(f"🚨 escalate_alert: '{pn}' -> '{at}'")
            _escalated_alerts.setdefault(pn, []).append(at)
            return {"status": "success", "message": f"Alert sent to {pn}."}
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
    doctor_prompt = build_doctor_agent_prompt("Samarth", "Endocrinologist", patient_name, persona_str)
    system_instruction = (
        f"{doctor_prompt}\n\n"
        "FORMATTING & MOOD PERCEPTION:\n"
        "Analyze both the spoken content AND the tone of the user's voice.\n"
        "Determine user_emotion (`happy`, `anxious`, `concerned`, `pain`, `neutral`, `curious`).\n"
        "Determine response_mood (`celebratory`, `calm_reassuring`, `empathetic_gentle`, `warm_clinical`).\n"
        "Respond STRICTLY in valid JSON:\n"
        '{"transcription": "<exact transcribed question>", "user_emotion": "<emotion>", '
        '"response_mood": "<mood>", "answer": "<warm 1-3 sentence clinical response>"}\n'
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

    voice = os.getenv("TTS_VOICE", "en-US-AvaNeural")
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
           "Call this the moment the doctor states, confirms, or switches to a patient name. "
           "Accepts a spoken patient name with any phone last-four phrase spoken in the same turn, or an exact patient ID. Phone digits alone are not a general search; they confirm only a pending duplicate-name choice.",
           {"patient_name": S(type=T.STRING, description="Patient name and, if spoken in the same turn, the phone-ending phrase; or an exact patient ID. Do not pass a phone number alone unless it is a pending four-digit confirmation.")}, ["patient_name"]),
        fd("get_patient_persona",
           "Alias for load_patient_record. Fetch a patient's clinical record by name or exact ID; preserve any phone last-four phrase spoken with the name so duplicates can be resolved in one turn.",
           {"patient_name": S(type=T.STRING, description="Patient name and any phone-ending phrase spoken in the same turn, or exact patient ID. Do not pass a phone number alone.")}, ["patient_name"]),
        fd("confirm_patient_by_phone_last4",
           "Use only after load_patient_record returned ambiguous. Matches exactly four spoken digits against the pending duplicate-name candidates in the cached roster. Phone digits are never returned.",
           {"last_four": S(type=T.STRING, description="Exactly the last four digits spoken by the doctor.")}, ["last_four"]),
        fd("add_clinical_note",
           "Save a clinical note dictated by the doctor for the current patient.",
           {"patient_name": S(type=T.STRING), "note_content": S(type=T.STRING)},
           ["patient_name", "note_content"]),
        fd("escalate_alert",
           "Send an alert or notification to the current patient.",
           {"patient_name": S(type=T.STRING),
            "alert_type": S(type=T.STRING,
                            enum=["glucose_high", "glucose_low", "bp_high", "medication_missed", "general"])},
           ["patient_name", "alert_type"]),
        fd("end_conversation",
           "Call only for a standalone conversation sign-off command: stop, goodbye, bye, that is all, or go to sleep. Do not call when 'stop' is part of a clinical instruction such as stopping a medication. The device returns to standby after the spoken sign-off.",
           {}, []),
    ])]


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
    connection_id = uuid.uuid4().hex
    logger.info(f"🟢 ESP32 connected — doctor_id='{doctor_id}'")

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

    resume = {"handle": None}
    advanced = os.getenv("LIVE_ADVANCED", "1") != "0"   # resumption + compression + transcription

    def make_config(use_advanced: bool):
        kwargs = dict(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name))),
            system_instruction=types.Content(parts=[types.Part.from_text(text=build_doctor_agent_prompt(
                doctor_name="Samarth", specialization="Endocrinologist"))]),
            tools=tools,
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    disabled=False,
                    start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                    prefix_padding_ms=200,
                    silence_duration_ms=800,
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

    async def esp32_receive_task():
        chunk_counter, audio_bytes = 0, 0
        streaming, last_audio_t = False, 0.0
        try:
            while True:
                try:
                    message = await asyncio.wait_for(websocket.receive(), timeout=0.25)
                except asyncio.TimeoutError:
                    # Safety net if the ESP32 never sends audio_end
                    if streaming and (loop.time() - last_audio_t > 2.0):
                        streaming = False
                        logger.info(f"🎤 [Server VAD turn end] {audio_bytes} bytes")
                        audio_bytes = 0
                        await queue_put(("turn_end", None))
                    continue

                if message.get("type") == "websocket.disconnect":
                    logger.info(f"🔴 ESP32 disconnected (session_id='{session_id}')")
                    esp["alive"] = False
                    return

                if message.get("bytes"):
                    data = message["bytes"]
                    pcm = data[44:] if data.startswith(b"RIFF") else data
                    if pcm:
                        last_audio_t, streaming = loop.time(), True
                        boosted = boost_chunk_gain(pcm)
                        audio_bytes += len(boosted)
                        chunk_counter += 1
                        await queue_put(("audio", boosted))
                        if chunk_counter % 50 == 0:
                            logger.info(f" 🎙️ streaming to Gemini ({audio_bytes} bytes this utterance)")
                elif message.get("text") and "audio_end" in message["text"]:
                    streaming = False
                    logger.info(f"🎤 [ESP32 utterance end] {audio_bytes} bytes")
                    audio_bytes = 0
                    await queue_put(("turn_end", None))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"ESP32 receive task error: {e}")
            esp["alive"] = False

    esp32_task = asyncio.create_task(esp32_receive_task())

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
            if not pcm:
                logger.warning("Status announcement TTS returned no audio")
                return False

            chunk_bytes = 8192
            for offset in range(0, len(pcm), chunk_bytes):
                chunk = pcm[offset:offset + chunk_bytes]
                now = loop.time()
                S["play_end"] = max(S["play_end"], now) + len(chunk) / BYTES_PER_SEC_OUT
                if not await ws_send_bytes(chunk):
                    return False
                lead = S["play_end"] - loop.time()
                if lead > MAX_LEAD_S:
                    await asyncio.sleep(lead - TARGET_LEAD_S)

            S["mute_until"] = S["play_end"] + POST_PLAYBACK_MUTE_S
            event = {"event": "status_audio_end"} if progress else {"event": "turn_complete"}
            if not await ws_send_json(event):
                return False
            logger.info("Spoke %s status announcement", "progress" if progress else "final")
            return True
        except asyncio.TimeoutError:
            logger.warning("Status announcement TTS timed out")
            return False
        except Exception as exc:
            logger.warning("Status announcement failed (%s)", type(exc).__name__)
            return False
        finally:
            S["is_speaking"] = previous_speaking_state if progress else False
            S["last_activity"] = loop.time()

    backoff, fail_count = 1.0, 0
    target_model = FALLBACK_LIVE_MODELS[0]
    gemini_has_been_active = False
    restart_notice_sent = False
    quota_notice_sent = False
    quota_waiting = False

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
                        nonlocal restart_notice_sent, quota_notice_sent, quota_waiting
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
                                    if getattr(response, "go_away", None) is not None:
                                        logger.info("⚠️ Gemini GoAway received; session will be resumed on reconnect")
                                        S["gemini_error"] = ConnectionError("Gemini Live requested session restart")

                                    # ---- tool calls (answer ALL calls of a message, always) ----
                                    if response.tool_call is not None:
                                        S["is_speaking"] = True
                                        frs = []
                                        for call in response.tool_call.function_calls:
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
                                                    result = await run_tool(call.name, dict(call.args or {}), doctor_id, connection_id)
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
                                    if getattr(sc, "output_transcription", None) and sc.output_transcription.text:
                                        out_txt.append(sc.output_transcription.text)

                                    if sc.model_turn is not None:
                                        S["is_speaking"] = True
                                        for part in (sc.model_turn.parts or []):
                                            if part.inline_data and part.inline_data.data:
                                                pcm16 = resampler.process(part.inline_data.data)
                                                if not pcm16:
                                                    continue
                                                t = loop.time()
                                                S["play_end"] = max(S["play_end"], t) + len(pcm16) / BYTES_PER_SEC_OUT
                                                if not await ws_send_bytes(pcm16):
                                                    return
                                                # PACING: never run more than MAX_LEAD_S ahead of real-time playback,
                                                # otherwise the ESP32 ring buffer overflows and audio is dropped.
                                                lead = S["play_end"] - loop.time()
                                                if lead > MAX_LEAD_S:
                                                    await asyncio.sleep(lead - TARGET_LEAD_S)

                                    if sc.interrupted or sc.turn_complete:
                                        if sc.interrupted and not sc.turn_complete:
                                            # An interrupted sign-off means the doctor resumed the conversation.
                                            S["end_after_turn"] = False
                                        if sc.turn_complete:
                                            # Only a completed Gemini turn proves that quota
                                            # access recovered; reconnect success alone does not.
                                            restart_notice_sent = False
                                            quota_notice_sent = False
                                            quota_waiting = False
                                            S["turn_pending"] = False
                                            S["pending_tool_failure_notice"] = None
                                        if in_txt:
                                            logger.info(f" 🎤 Doctor: {''.join(in_txt).strip()}")
                                        if out_txt:
                                            logger.info(f" 🗣️ Assistant: {''.join(out_txt).strip()}")
                                        in_txt, out_txt = [], []

                                        tail = resampler.flush()
                                        if tail:
                                            S["play_end"] = max(S["play_end"], loop.time()) + len(tail) / BYTES_PER_SEC_OUT
                                            if not await ws_send_bytes(tail):
                                                return
                                        S["is_speaking"] = False
                                        S["mute_until"] = S["play_end"] + POST_PLAYBACK_MUTE_S
                                        S["last_activity"] = loop.time()
                                        logger.info(f"✅ [Turn {'Interrupted' if sc.interrupted else 'Complete'}] "
                                                    f"(~{max(0.0, S['play_end'] - loop.time()):.1f}s of audio still playing on device)")
                                        await asyncio.sleep(0.03)
                                        if sc.turn_complete and S["end_after_turn"]:
                                            if not await ws_send_json({"event": "conversation_end"}):
                                                return
                                            S["end_after_turn"] = False
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
                                        else GEMINI_NO_PROGRESS_TIMEOUT_S
                                    )):
                                logger.warning("Gemini made no progress for %.1fs; speaking a status and reconnecting",
                                               GEMINI_NO_PROGRESS_TIMEOUT_S)
                                S["gemini_error"] = TimeoutError("Gemini made no progress on the active turn")
                                break

                            try:
                                kind, data = await asyncio.wait_for(audio_queue.get(), timeout=0.25)
                            except asyncio.TimeoutError:
                                continue

                            blocked = S["is_speaking"] or loop.time() < S["mute_until"]
                            if kind == "audio":
                                S["last_activity"] = loop.time()
                                if blocked:
                                    continue      # don't feed the assistant its own voice / echo
                                try:
                                    await session.send_realtime_input(
                                        audio=types.Blob(data=data, mime_type="audio/pcm;rate=16000"))
                                except Exception as e:
                                    S["gemini_error"] = e
                                    logger.warning(f"Gemini send error: {e}. Reconnecting...")
                                    break
                            elif kind == "turn_end":
                                if blocked:
                                    continue
                                S["last_activity"] = loop.time()
                                S["last_rx"] = loop.time()
                                S["turn_pending"] = True
                                try:
                                    # Gemini's automatic VAD owns turn-taking; this just flushes cached audio.
                                    await session.send_realtime_input(audio_stream_end=True)
                                    logger.info("🎤 [audio_stream_end] sent to Gemini")
                                except Exception as e:
                                    S["gemini_error"] = e
                                    logger.warning(f"audio_stream_end error: {e}. Reconnecting...")
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
                        logger.warning("Gemini quota retry paused for 60 seconds")
                        await asyncio.sleep(60.0)
                    else:
                        await asyncio.sleep(0.4)   # avoid a hot reconnect loop

            except WebSocketDisconnect:
                logger.info(f"🔴 ESP32 WebSocket closed (session_id='{session_id}')")
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
                    logger.warning("Gemini quota retry paused for 60 seconds")
                    await asyncio.sleep(60.0)
                    backoff = 1.0
                else:
                    logger.warning(f"⚡ Gemini reconnect in {backoff:.1f}s: {err}")
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 10.0)
    finally:
        await delete_conversation_state(doctor_id, connection_id, "pending_patient")
        esp32_task.cancel()
        await asyncio.gather(esp32_task, return_exceptions=True)

    logger.info(f"🔴 WebSocket session fully closed (session_id='{session_id}')")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8008))
    logger.info(f"Starting server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port, ws_ping_interval=None, ws_ping_timeout=None, timeout_keep_alive=600)
