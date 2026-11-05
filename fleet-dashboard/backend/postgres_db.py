import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from typing import List, Dict, Any, Optional

PG_HOST = os.getenv("PG_HOST", "localhost")
PG_PORT = int(os.getenv("PG_PORT", "5433"))
PG_USER = os.getenv("PG_USER", "postgres")
PG_PASSWORD = os.getenv("PG_PASSWORD", "postgrespassword")
PG_DB = os.getenv("PG_DATABASE", "yhealth_db")

FALLBACK_JSON = os.path.join(os.path.dirname(__file__), "fleet_db.json")

def get_connection():
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        user=PG_USER,
        password=PG_PASSWORD,
        dbname=PG_DB,
        connect_timeout=3
    )

def _row_to_speaker_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transforms a Postgres database row into the exact speaker schema
    expected by the React frontend and Voice Server.
    """
    role = row.get("role", "patient")
    telemetry = row.get("telemetry") or {}
    if isinstance(telemetry, str):
        try:
            telemetry = json.loads(telemetry)
        except Exception:
            telemetry = {}

    is_doc = (role == "doctor")
    name = (row.get("doctor_name") if is_doc else row.get("patient_name")) or telemetry.get("name") or row.get("device_id")
    phone = (row.get("phone") if is_doc else row.get("patient_phone")) or telemetry.get("phone") or ""
    email = (row.get("email") if is_doc else row.get("patient_email")) or telemetry.get("email") or ""

    speaker = {
        "device_id": row.get("device_id"),
        "mac_address": row.get("mac_address") or telemetry.get("mac_address") or "",
        "role": role,
        "name": name,
        "phone": phone,
        "email": email,
        "status": row.get("status", "offline"),
        "volume": row.get("boot_volume", 75),
        "ip_address": str(row.get("current_ip")) if row.get("current_ip") else telemetry.get("ip_address"),
        "hardware_version": row.get("hardware_version", "ESP32-S3-DevKitC-1"),
        "firmware_version": row.get("firmware_version", "v1.4.2-bargein"),
        "wifi_ssid": telemetry.get("wifi_ssid", "TFTus-WiFi" if is_doc else "Home-WiFi"),
        "wifi_rssi": row.get("last_rssi") or telemetry.get("wifi_rssi", -50),
        "wifi_connected": telemetry.get("wifi_connected", True if row.get("status") in ("online", "standby") else False),
        "status_reason": telemetry.get("status_reason", ""),
        "last_network_log": telemetry.get("last_network_log", ""),
        "last_network_time": telemetry.get("last_network_time", ""),
        "power_source": telemetry.get("power_source", "100% (USB-C Powered)"),
        "stream_rate": telemetry.get("stream_rate", "16 kHz Mono PCM (32 KB/s)"),
        "last_seen_at": "Just now" if row.get("status") in ("online", "standby") else "Offline"
    }

    if is_doc:
        speaker.update({
            "doctor_id": row.get("assigned_doctor_id") or telemetry.get("doctor_id") or "",
            "specialization": row.get("doctor_specialization") or telemetry.get("specialization") or "General Physician",
            "clinic_name": row.get("clinic_name") or telemetry.get("clinic_name") or "YHealth Partner Clinic",
            "clinic_address": row.get("clinic_address") or telemetry.get("clinic_address") or "",
            "active_patients_count": telemetry.get("active_patients_count", 25)
        })
    else:
        speaker.update({
            "patient_id": row.get("assigned_patient_id") or telemetry.get("patient_id") or "",
            "doctor_assigned_name": row.get("doctor_name") or telemetry.get("doctor_assigned_name") or "Assigned Physician",
            "doctor_assigned_id": row.get("assigned_doctor_id") or telemetry.get("doctor_assigned_id") or "",
            "enrolled_program": row.get("enrolled_program") or telemetry.get("enrolled_program") or "Care Management",
            "main_goal": row.get("main_goal") or telemetry.get("main_goal") or "Health Maintenance",
            "address": row.get("clinic_address") or telemetry.get("address") or "",
            "bed_location": telemetry.get("bed_location", "Home Care (Bedside Station)"),
            "last_voice_checkin": telemetry.get("last_voice_checkin", "Scheduled today")
        })

    return speaker


def get_all_speakers() -> List[Dict[str, Any]]:
    """Loads all speakers from PostgreSQL with graceful fallback to fleet_db.json."""
    try:
        conn = get_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM devices ORDER BY device_id ASC;")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        if rows:
            return [_row_to_speaker_dict(dict(r)) for r in rows]
    except Exception as e:
        print(f"[PG WARNING] Could not query PostgreSQL ({e}). Falling back to fleet_db.json.")

    if os.path.exists(FALLBACK_JSON):
        with open(FALLBACK_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def get_speaker_by_id(device_id_or_mac: str) -> Optional[Dict[str, Any]]:
    """Finds a speaker by device_id or mac_address in PostgreSQL."""
    clean = device_id_or_mac.strip().upper()
    try:
        conn = get_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT * FROM devices 
            WHERE UPPER(device_id) = %s OR UPPER(mac_address) = %s 
            LIMIT 1;
        """, (clean, clean))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            return _row_to_speaker_dict(dict(row))
    except Exception as e:
        print(f"[PG WARNING] query failed: {e}")

    # Fallback to in-memory/json
    for s in get_all_speakers():
        if s.get("device_id", "").upper() == clean or s.get("mac_address", "").upper() == clean:
            return s
    return None


def upsert_speaker(spk: Dict[str, Any]) -> Dict[str, Any]:
    """Upserts a speaker in PostgreSQL and keeps fleet_db.json in sync."""
    device_id = spk.get("device_id")
    mac = spk.get("mac_address")
    role = spk.get("role", "patient")
    status = spk.get("status", "offline")
    vol = int(spk.get("volume", 75))
    ip = spk.get("ip_address") or None
    is_doc = (role == "doctor")

    doc_id = (spk.get("doctor_id") if is_doc else spk.get("doctor_assigned_id")) or None
    doc_name = (spk.get("name") if is_doc else spk.get("doctor_assigned_name")) or None
    doc_spec = spk.get("specialization") if is_doc else None
    clinic_name = spk.get("clinic_name") if is_doc else None
    clinic_addr = spk.get("clinic_address") or spk.get("address") or None

    pat_id = spk.get("patient_id") if not is_doc else None
    pat_name = spk.get("name") if not is_doc else None
    pat_phone = spk.get("phone") if not is_doc else None
    pat_email = spk.get("email") if not is_doc else None
    program = spk.get("enrolled_program") if not is_doc else None
    goal = spk.get("main_goal") if not is_doc else None

    try:
        conn = get_connection()
        cur = conn.cursor()

        if is_doc and doc_id and doc_name:
            cur.execute("""
                INSERT INTO doctors (doctor_id, full_name, specialization, hospital_name, active)
                VALUES (%s, %s, %s, %s, true)
                ON CONFLICT (doctor_id) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    specialization = EXCLUDED.specialization,
                    hospital_name = EXCLUDED.hospital_name;
            """, (doc_id, doc_name, doc_spec or 'General', clinic_name or 'YHealth Clinic'))

        if not is_doc and pat_id and pat_name:
            cur.execute("""
                INSERT INTO patients (patient_id, full_name, phone, program_enrolled, primary_doctor_id)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (patient_id) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    phone = EXCLUDED.phone,
                    program_enrolled = EXCLUDED.program_enrolled,
                    primary_doctor_id = EXCLUDED.primary_doctor_id;
            """, (pat_id, pat_name, pat_phone, program or 'Care Plan', doc_id if doc_id else None))

        cur.execute("""
            INSERT INTO devices (
                device_id, mac_address, role, status, boot_volume, current_ip,
                assigned_doctor_id, assigned_patient_id,
                doctor_name, doctor_specialization, clinic_name, clinic_address,
                patient_name, patient_phone, patient_email, enrolled_program, main_goal,
                telemetry
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s
            )
            ON CONFLICT (device_id) DO UPDATE SET
                mac_address = COALESCE(EXCLUDED.mac_address, devices.mac_address),
                role = COALESCE(EXCLUDED.role, devices.role),
                status = COALESCE(EXCLUDED.status, devices.status),
                boot_volume = COALESCE(EXCLUDED.boot_volume, devices.boot_volume),
                current_ip = COALESCE(EXCLUDED.current_ip, devices.current_ip),
                assigned_doctor_id = COALESCE(EXCLUDED.assigned_doctor_id, devices.assigned_doctor_id),
                assigned_patient_id = COALESCE(EXCLUDED.assigned_patient_id, devices.assigned_patient_id),
                doctor_name = COALESCE(EXCLUDED.doctor_name, devices.doctor_name),
                doctor_specialization = COALESCE(EXCLUDED.doctor_specialization, devices.doctor_specialization),
                clinic_name = COALESCE(EXCLUDED.clinic_name, devices.clinic_name),
                clinic_address = COALESCE(EXCLUDED.clinic_address, devices.clinic_address),
                patient_name = COALESCE(EXCLUDED.patient_name, devices.patient_name),
                patient_phone = COALESCE(EXCLUDED.patient_phone, devices.patient_phone),
                patient_email = COALESCE(EXCLUDED.patient_email, devices.patient_email),
                enrolled_program = COALESCE(EXCLUDED.enrolled_program, devices.enrolled_program),
                main_goal = COALESCE(EXCLUDED.main_goal, devices.main_goal),
                telemetry = EXCLUDED.telemetry;
        """, (
            device_id, mac, role, status, vol, ip,
            doc_id, pat_id,
            doc_name, doc_spec, clinic_name, clinic_addr,
            pat_name, pat_phone, pat_email, program, goal,
            Json(spk)
        ))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[PG ERROR] Failed to upsert into Postgres: {e}")

    # Also keep fleet_db.json in sync as snapshot
    try:
        all_spks = get_all_speakers()
        with open(FALLBACK_JSON, "w", encoding="utf-8") as f:
            json.dump(all_spks, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[JSON ERROR] Could not sync fleet_db.json: {e}")

    return spk


def delete_speaker(device_id: str) -> bool:
    """Deletes a speaker from PostgreSQL and syncs fleet_db.json."""
    clean = device_id.strip().upper()
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM devices WHERE UPPER(device_id) = %s;", (clean,))
        deleted_count = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        
        all_spks = get_all_speakers()
        with open(FALLBACK_JSON, "w", encoding="utf-8") as f:
            json.dump(all_spks, f, indent=2, ensure_ascii=False)
            
        return deleted_count > 0
    except Exception as e:
        print(f"[PG ERROR] Failed to delete from Postgres: {e}")
        return False
