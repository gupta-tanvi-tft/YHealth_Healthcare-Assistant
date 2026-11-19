"""Import a complete API 1 response into the backend's Redis roster cache.

This is intended for recovery when API 1 temporarily returns an empty roster.
The input file stays outside the repository; only the Redis cache is populated.
"""
import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))


def _cache_key(prefix: str, doctor_id: str) -> str:
    safe = [re.sub(r"[^A-Za-z0-9_-]", "_", part) for part in (prefix, "roster", doctor_id)]
    return ":".join(safe)


def _extract_roster(data):
    if isinstance(data, list):
        return data, None
    if not isinstance(data, dict):
        raise ValueError("Input must be a JSON list or an API response object.")
    roster = data.get("patients")
    if roster is None:
        roster = data.get("data") or data.get("patient_list")
    if isinstance(roster, dict):
        roster = roster.get("patients") or roster.get("data")
    if not isinstance(roster, list) or not roster:
        raise ValueError("The input does not contain a non-empty patients list.")
    return roster, data.get("total")


def _validate_roster(roster, reported_total):
    if reported_total is not None and int(reported_total) != len(roster):
        raise ValueError(f"Incomplete roster: API total is {reported_total}, parsed {len(roster)}.")
    missing_id = 0
    missing_name = 0
    for patient in roster:
        if not isinstance(patient, dict):
            raise ValueError("Roster contains a non-object patient entry.")
        if not any(patient.get(k) for k in ("_id", "id", "patient_id", "patientId", "mongo_patient_id")):
            missing_id += 1
        name = any(patient.get(k) for k in ("name", "full_name", "fullName", "patient_name", "patientName", "first_name", "firstName"))
        if not name:
            missing_name += 1
    if missing_id or missing_name:
        raise ValueError(f"Roster validation failed: {missing_id} entries lack IDs and {missing_name} lack names.")


async def main():
    parser = argparse.ArgumentParser(description="Seed a validated full patient roster into the local Redis cache.")
    parser.add_argument("json_file", help="Path to the saved API 1 JSON response; keep this file private.")
    parser.add_argument("--doctor-id", default=os.getenv("PATIENTS_API_DOCTOR_ID"), help="Doctor ID used to scope the Redis key.")
    parser.add_argument("--replace", action="store_true", help="Replace an existing cached roster for this doctor.")
    args = parser.parse_args()

    if not args.doctor_id:
        parser.error("Provide --doctor-id or set PATIENTS_API_DOCTOR_ID in backend/.env.")
    source = Path(args.json_file)
    try:
        payload = json.loads(source.read_text(encoding="utf-8-sig"))
        roster, total = _extract_roster(payload)
        _validate_roster(roster, total)
    except Exception as exc:
        print(f"Roster import stopped: {exc}", file=sys.stderr)
        return 2

    try:
        from redis.asyncio import Redis
    except ImportError:
        print("Redis client is missing. Run: python -m pip install -r requirements.txt", file=sys.stderr)
        return 2

    url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    use_tls = os.getenv("REDIS_TLS", "0").strip().lower() in {"1", "true", "yes", "on"}
    if use_tls and url.startswith("redis://"):
        url = "rediss://" + url[len("redis://"):]
    key = _cache_key(os.getenv("REDIS_KEY_PREFIX", "yhealth-assistant"), args.doctor_id)
    ttl = max(1, int(os.getenv("REDIS_ROSTER_TTL_S", "86400")))
    client = Redis.from_url(url, encoding="utf-8", decode_responses=True,
                            socket_connect_timeout=1.0, socket_timeout=2.0)
    try:
        await client.ping()
        if not args.replace and await client.exists(key):
            print("A roster is already cached for this doctor. Re-run with --replace only if this file is the correct full roster.", file=sys.stderr)
            return 2
        raw = json.dumps(roster, ensure_ascii=False, separators=(",", ":"))
        await client.set(key, raw, ex=ttl)
        saved = json.loads(await client.get(key))
        if len(saved) != len(roster):
            raise RuntimeError("Redis verification count did not match the imported roster.")
        print(f"Imported and verified {len(saved)} patients in Redis for doctor {args.doctor_id}; TTL={ttl}s.")
        return 0
    except Exception as exc:
        # Do not include connection strings in errors; Redis URLs may contain credentials.
        print(f"Redis roster import failed: {type(exc).__name__}.", file=sys.stderr)
        return 1
    finally:
        await client.aclose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
