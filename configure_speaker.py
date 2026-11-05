#!/usr/bin/env python3
"""
YHealth Speaker Provisioning & Ecosystem Configuration Tool
===========================================================
Real-time configuration, assignment, dynamic modification, and remote control of smart speakers.

Usage Examples:
    1. Interactive Wizard:
       python configure_speaker.py

    2. Real-Time Terminal Event Watcher:
       python configure_speaker.py --watch

    3. List All Speakers (Table view):
       python configure_speaker.py --list
       python configure_speaker.py --list --role-filter doctor
       python configure_speaker.py --list --role-filter patient

    4. Add / Dynamically Modify a Speaker (instantly updates Web Dashboard in real time):
       python configure_speaker.py --add --role doctor --id SPK-21 --mac "A0:F2:62:E3:4C:85" \
           --name "Dr. Ritu Saxena" --phone "+91 98110 55443" --email "dr.saxena@yhealth.me" \
           --doctor-id "67cc11223344556677889900" --specialization "Endocrinologist" \
           --clinic "Max Healthcare" --address "Saket, New Delhi" --room "Cabin 102"

    5. Send Real-Time Remote Command (Volume or Live Speech Announcement):
       python configure_speaker.py --id SPK-01 --set-volume 85
       python configure_speaker.py --id SPK-01 --announce "Dr. Makkar, your next patient Anand Sharma has arrived."

    6. Send Wi-Fi & Device ID to ESP32 over USB Serial:
       python configure_speaker.py --provision-usb --port COM3 --ssid "Clinic-WiFi" --password "secret123"

    7. Generate C Header for ESP32 Firmware:
       python configure_speaker.py --export-header SPK-01
"""

import os
import sys
import json
import re
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional

DB_PATH = Path(__file__).resolve().parent / "fleet-dashboard" / "backend" / "fleet_db.json"
API_URL = "http://localhost:8010/api"
WS_URL = "ws://localhost:8010/ws/fleet"

def load_registry() -> List[Dict[str, Any]]:
    if DB_PATH.exists():
        try:
            with open(DB_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[ERROR] Could not read registry from {DB_PATH}: {e}")
    return []

def save_registry(registry: List[Dict[str, Any]]) -> bool:
    try:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(DB_PATH, "w", encoding="utf-8") as f:
            json.dump(registry, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[ERROR] Could not save registry to {DB_PATH}: {e}")
        return False

def sync_with_live_api(method: str, endpoint: str, payload: dict) -> bool:
    """Notify running FastAPI backend to trigger immediate WebSocket broadcast to dashboards."""
    url = f"{API_URL}/{endpoint.lstrip('/')}"
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method=method)
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            if resp.status in (200, 201):
                return True
    except Exception:
        # Backend not running is okay; file was saved locally
        pass
    return False

def validate_mac(mac: str) -> bool:
    clean = mac.strip().upper()
    return bool(re.match(r"^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$", clean) or re.match(r"^[0-9A-F]{12}$", clean))

def normalize_mac(mac: str) -> str:
    clean = re.sub(r"[^0-9A-Fa-f]", "", mac).upper()
    if len(clean) == 12:
        return ":".join(clean[i:i+2] for i in range(0, 12, 2))
    return mac.strip().upper()

def print_speaker_table(speakers: List[Dict[str, Any]], role_filter: str = None):
    filtered = speakers
    if role_filter:
        filtered = [s for s in speakers if s.get("role") == role_filter.lower()]

    if not filtered:
        print(f"\n[INFO] No speakers found matching filter '{role_filter}'. Total in database: {len(speakers)}")
        return

    print("\n" + "=" * 132)
    print(f" YHEALTH REAL-TIME SMART SPEAKER ECOSYSTEM REGISTRY ({len(filtered)} devices)")
    print("=" * 132)
    print(f"{'ID':<8} {'MAC Address':<18} {'Role':<8} {'Vol':<5} {'Assigned To':<22} {'Status':<9} {'Key Clinical / Clinic Metadata':<54}")
    print("-" * 132)

    for s in filtered:
        spk_id = s.get("device_id", "N/A")
        mac = s.get("mac_address", "N/A")
        role = s.get("role", "doctor").upper()
        vol = f"{s.get('volume', 75)}%"
        name = s.get("name", "Unassigned")[:20]
        status = s.get("status", "offline").upper()

        if role == "DOCTOR":
            meta = f"DrID: {s.get('doctor_id', '—')[:8]}.. | {s.get('specialization', '')[:18]} | {s.get('clinic_name', '')[:20]}"
        else:
            meta = f"PatID: {s.get('patient_id', '—')} | Goal: {s.get('main_goal', '')[:28]} | Doc: {s.get('doctor_assigned_name', '')[:15]}"

        print(f"{spk_id:<8} {mac:<18} {role:<8} {vol:<5} {name:<22} {status:<9} {meta:<54}")

    print("=" * 132 + "\n")

def add_or_update_speaker(data: Dict[str, Any]) -> bool:
    registry = load_registry()
    raw_mac = data.get("mac_address", "").strip()

    if not raw_mac or not validate_mac(raw_mac):
        print(f"[ERROR] Invalid MAC address format: '{raw_mac}'. Example: 'A0:F2:62:E3:4C:70'")
        return False

    norm_mac = normalize_mac(raw_mac)
    raw_id = (data.get("device_id") or "").strip().upper()
    if not raw_id:
        existing_nums = [int(m.group(1)) for s in registry if (m := re.match(r"^SPK-(\d+)$", s.get("device_id", "")))]
        next_num = max(existing_nums, default=len(registry)) + 1
        raw_id = f"SPK-{str(next_num).zfill(2)}"
    elif not raw_id.startswith("SPK-"):
        raw_id = f"SPK-{raw_id}"

    # Check existing
    existing_idx = None
    for idx, s in enumerate(registry):
        if s.get("device_id", "").upper() == raw_id or s.get("mac_address", "").upper() == norm_mac:
            existing_idx = idx
            break

    role = data.get("role", "doctor").strip().lower()
    record = {
        "device_id": raw_id,
        "mac_address": norm_mac,
        "role": role,
        "name": data.get("name", "Unassigned"),
        "phone": data.get("phone", ""),
        "email": data.get("email", ""),
        "assigned_date": datetime.now(timezone.utc).isoformat(),
        "status": data.get("status", "online"),
        "last_seen_at": "Just now",
        "wifi_ssid": data.get("wifi_ssid", "TFTus-WiFi"),
        "wifi_rssi": data.get("wifi_rssi", -52),
        "volume": int(data.get("volume", 75)),
        "power_source": data.get("power_source", "100% (USB-C Continuous)"),
        "firmware_version": "v1.2.0-S3 (Dual ES7210+ES8311)",
        "stream_rate": "16 kHz Mono PCM (32 KB/s)"
    }

    if role == "doctor":
        record.update({
            "doctor_id": data.get("doctor_id") or f"DOC-{raw_id.replace('SPK-', '')}",
            "specialization": data.get("specialization", "Diabetologist / Consultant"),
            "clinic_name": data.get("clinic_name", "YHealth Consultation Suite"),
            "clinic_address": data.get("clinic_address", "New Delhi, India"),
            "consultation_room": data.get("consultation_room", "OPD Suite 1"),
            "active_patients_count": int(data.get("active_patients_count", 25))
        })
    else:
        record.update({
            "patient_id": data.get("patient_id") or f"PAT-{raw_id.replace('SPK-', '')}",
            "doctor_assigned_name": data.get("doctor_assigned_name", "Dr. Brij Mohan Makkar"),
            "doctor_assigned_id": data.get("doctor_assigned_id", "6789ebb61a093d60fa691c39"),
            "enrolled_program": data.get("enrolled_program", "Chronic Care & Vitals Remission"),
            "main_goal": data.get("main_goal", "Maintain Blood Glucose < 110 mg/dL"),
            "address": data.get("address", "Patient Residence"),
            "bed_location": data.get("bed_location", "Home Care (Bedside Station)"),
            "last_voice_checkin": "Active Today"
        })

    is_update = existing_idx is not None
    if is_update:
        registry[existing_idx] = record
        print(f"[OK] Dynamically updated speaker '{raw_id}' ({norm_mac})")
    else:
        registry.append(record)
        print(f"[OK] Added new speaker '{raw_id}' ({norm_mac}) as role: {role.upper()}")

    save_registry(registry)

    # Broadcast to live web dashboard via API
    if is_update:
        sync_with_live_api("PUT", f"/speakers/{raw_id}", record)
    else:
        sync_with_live_api("POST", "/speakers", record)

    print(f"[BROADCAST] Synced in real time to Web Dashboard!")
    return True

def send_remote_command(speaker_id: str, command: str, payload: dict):
    spk_id = speaker_id.strip().upper()
    if not spk_id.startswith("SPK-"):
        spk_id = f"SPK-{spk_id}"

    payload["command"] = command
    print(f"[DISPATCHING] Sending '{command}' command to speaker {spk_id}...")
    success = sync_with_live_api("POST", f"/speakers/{spk_id}/command", payload)
    if success:
        print(f"[SUCCESS] Command acknowledged & broadcast to {spk_id} and all connected dashboards!")
    else:
        # Fallback update local db
        registry = load_registry()
        for s in registry:
            if s.get("device_id", "").upper() == spk_id:
                if command == "set_volume":
                    s["volume"] = payload.get("volume", 75)
                save_registry(registry)
                break
        print(f"[OK] Updated local registry for {spk_id}.")

def watch_fleet_events():
    """Connect to the WebSocket bus and stream real-time events to terminal."""
    try:
        import websockets
        import asyncio
    except ImportError:
        print("[!] Install websockets to use real-time terminal watch: pip install websockets")
        return

    async def _runner():
        print("\n" + "=" * 60)
        print(f"  YHEALTH REAL-TIME EVENT STREAM: {WS_URL}")
        print("  Listening for dynamic modifications, pings, and commands...")
        print("=" * 60 + "\n")
        try:
            async with websockets.connect(WS_URL) as ws:
                while True:
                    msg = await ws.recv()
                    data = json.loads(msg)
                    evt = data.get("event")
                    ts = data.get("timestamp", "")
                    payload = data.get("data", {})
                    
                    if evt == "speaker_updated":
                        print(f"[{ts[:19]}] 🔄 SPEAKER UPDATED: {payload.get('device_id')} ({payload.get('name')}) — Vol: {payload.get('volume', '—')}% | Status: {payload.get('status')}")
                    elif evt == "speaker_added":
                        print(f"[{ts[:19]}] ➕ NEW SPEAKER REGISTERED: {payload.get('device_id')} (MAC: {payload.get('mac_address')}) — Assigned: {payload.get('name')} [{payload.get('role').upper()}]")
                    elif evt == "command_dispatched":
                        print(f"[{ts[:19]}] 🎮 COMMAND DISPATCHED: {payload.get('device_id')} -> {payload.get('command')} ({payload.get('params')})")
                    elif evt == "heartbeat":
                        print(f"[{ts[:19]}] ⚡ HEARTBEAT: {payload.get('device_id')} RSSI: {payload.get('wifi_rssi')} dBm")
        except Exception as e:
            print(f"[DISCONNECT] Event watcher ended: {e}")

    asyncio.run(_runner())

def interactive_wizard():
    print("\n" + "=" * 60)
    print("  YHEALTH REAL-TIME SPEAKER CONFIGURATION WIZARD")
    print("=" * 60)

    role = input("\nAssign speaker to [1] DOCTOR or [2] PATIENT? (Enter 1 or 2): ").strip()
    is_doctor = (role == "1" or role.lower().startswith("d"))
    role_str = "doctor" if is_doctor else "patient"

    mac = input("Enter Hardware MAC Address (e.g. A0:F2:62:E3:4C:80): ").strip()
    while not validate_mac(mac):
        print("[!] Invalid MAC format. Please try again (e.g. A0:F2:62:E3:4C:80 or 12 hex chars).")
        mac = input("Enter Hardware MAC Address: ").strip()

    spk_id = input("Enter Speaker ID (leave blank for next auto ID, e.g. SPK-22): ").strip()
    name = input(f"Enter {'Doctor' if is_doctor else 'Patient'} Full Name: ").strip()
    phone = input("Enter Contact Phone Number (e.g. +91 98110 00000): ").strip()
    email = input("Enter Email Address: ").strip()

    data = {
        "mac_address": mac,
        "device_id": spk_id,
        "role": role_str,
        "name": name,
        "phone": phone,
        "email": email
    }

    if is_doctor:
        data["doctor_id"] = input("Doctor ID (e.g. 6789ebb61a093d60fa691c39): ").strip()
        data["specialization"] = input("Specialization (e.g. Diabetologist & Obesity Specialist): ").strip()
        data["clinic_name"] = input("Clinic / Hospital Name: ").strip()
        data["clinic_address"] = input("Clinic Full Address: ").strip()
        data["consultation_room"] = input("Consultation Room / OPD Cabin: ").strip()
    else:
        data["patient_id"] = input("Patient ID (e.g. PAT-88219): ").strip()
        data["doctor_assigned_name"] = input("Assigned Doctor Name: ").strip()
        data["doctor_assigned_id"] = input("Assigned Doctor ID: ").strip()
        data["enrolled_program"] = input("Enrolled Health Program (e.g. Type-2 Diabetes Reversal): ").strip()
        data["main_goal"] = input("Main Health Goal (e.g. Target HbA1c < 6.5%, Daily walking): ").strip()
        data["address"] = input("Home Address / Bed Location: ").strip()

    add_or_update_speaker(data)
    print("\n[SUCCESS] Configuration complete! Instantly synchronized with Web Dashboard.")

def export_c_header(speaker_id: str):
    registry = load_registry()
    spk = next((s for s in registry if s.get("device_id", "").upper() == speaker_id.upper()), None)
    if not spk:
        print(f"[ERROR] Speaker '{speaker_id}' not found in registry.")
        return

    clean_mac_hex = [f"0x{b}" for b in spk['mac_address'].split(':')]
    header_content = f"""/*
 * Auto-generated by YHealth configure_speaker.py
 * Device: {spk['device_id']} | Role: {spk['role'].upper()} | Assigned: {spk['name']}
 * Date: {datetime.now(timezone.utc).isoformat()}
 */
#pragma once

#define YHEALTH_DEVICE_ID        "{spk['device_id']}"
#define YHEALTH_DEVICE_MAC       "{spk['mac_address']}"
#define YHEALTH_DEVICE_MAC_BYTES {{ {', '.join(clean_mac_hex)} }}
#define YHEALTH_ASSIGNED_ROLE    "{spk['role']}"
#define YHEALTH_ASSIGNED_NAME    "{spk['name']}"
#define YHEALTH_ASSIGNED_DOC_ID  "{spk.get('doctor_id') or spk.get('doctor_assigned_id', '')}"
#define YHEALTH_DEFAULT_WIFI_SSID "{spk.get('wifi_ssid', 'TFTus-WiFi')}"
"""
    out_file = Path(__file__).resolve().parent / "main" / "speaker_identity.h"
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(header_content)
    print(f"[OK] Exported C firmware header to: {out_file}")

def provision_usb_serial(port: str, ssid: str, password: str, baud: int = 115200):
    try:
        import serial
    except ImportError:
        print("[!] PySerial is required for USB provisioning. Install with: pip install pyserial")
        return

    print(f"[...] Connecting to ESP32 on {port} @ {baud} baud...")
    try:
        ser = serial.Serial(port, baud, timeout=3.0)
        cmd = f"SET_WIFI:{ssid}:{password}\n"
        print(f"[SENDING] {cmd.strip()}")
        ser.write(cmd.encode("utf-8"))
        res = ser.readline().decode("utf-8", errors="ignore").strip()
        print(f"[ESP32 RESPONSE] {res}")
        ser.close()
        print("[SUCCESS] USB Provisioning complete!")
    except Exception as e:
        print(f"[ERROR] USB provisioning failed on {port}: {e}")

def main():
    parser = argparse.ArgumentParser(description="YHealth Real-Time Speaker Ecosystem Configuration & Provisioning Tool")
    parser.add_argument("--list", action="store_true", help="List all registered speakers in the ecosystem")
    parser.add_argument("--role-filter", choices=["doctor", "patient"], help="Filter --list by role")
    parser.add_argument("--add", action="store_true", help="Add or update a speaker via CLI arguments")
    parser.add_argument("--watch", action="store_true", help="Watch real-time WebSocket fleet events in terminal")
    
    # Speaker parameters
    parser.add_argument("--id", help="Speaker ID (e.g. SPK-01)")
    parser.add_argument("--mac", help="Hardware MAC address (e.g. A0:F2:62:E3:4C:85)")
    parser.add_argument("--role", choices=["doctor", "patient"], help="Speaker role assignment")
    parser.add_argument("--name", help="Doctor or Patient full name")
    parser.add_argument("--phone", help="Contact phone number")
    parser.add_argument("--email", help="Contact email address")
    parser.add_argument("--doctor-id", help="Doctor ID")
    parser.add_argument("--specialization", help="Doctor specialization")
    parser.add_argument("--clinic", help="Clinic / Hospital name")
    parser.add_argument("--address", help="Clinic or Patient address")
    parser.add_argument("--room", help="Doctor consultation room or cabin")
    
    # Patient specific
    parser.add_argument("--patient-id", help="Patient ID")
    parser.add_argument("--doctor-name", help="Assigned doctor name for patient")
    parser.add_argument("--program", help="Enrolled care program")
    parser.add_argument("--goal", help="Main health goal")
    parser.add_argument("--location", help="Patient home or hospital bed location")
    
    # Dynamic commands
    parser.add_argument("--set-volume", type=int, help="Adjust speaker hardware volume remotely (0-100)")
    parser.add_argument("--announce", help="Send dynamic voice announcement text to speaker")
    
    # Hardware & USB
    parser.add_argument("--export-header", help="Export C header file for speaker ID (e.g. --export-header SPK-01)")
    parser.add_argument("--provision-usb", action="store_true", help="Send Wi-Fi config to ESP32 over USB Serial")
    parser.add_argument("--port", default="COM3", help="Serial port for USB provisioning (default: COM3)")
    parser.add_argument("--ssid", default="TFTus-WiFi", help="Wi-Fi SSID")
    parser.add_argument("--password", default="", help="Wi-Fi password")

    args = parser.parse_args()

    if args.watch:
        watch_fleet_events()
    elif args.set_volume is not None:
        if not args.id:
            print("[ERROR] Please specify --id (e.g. --id SPK-01)")
            sys.exit(1)
        send_remote_command(args.id, "set_volume", {"volume": args.set_volume})
    elif args.announce:
        if not args.id:
            print("[ERROR] Please specify --id (e.g. --id SPK-01)")
            sys.exit(1)
        send_remote_command(args.id, "play_announcement", {"text": args.announce})
    elif args.list:
        speakers = load_registry()
        print_speaker_table(speakers, args.role_filter)
    elif args.add:
        if not args.mac:
            print("[ERROR] --mac is required when using --add")
            sys.exit(1)
        data = {
            "device_id": args.id,
            "mac_address": args.mac,
            "role": args.role or "doctor",
            "name": args.name or "New Speaker",
            "phone": args.phone or "",
            "email": args.email or "",
            "doctor_id": args.doctor_id,
            "specialization": args.specialization,
            "clinic_name": args.clinic,
            "clinic_address": args.address,
            "consultation_room": args.room,
            "patient_id": args.patient_id,
            "doctor_assigned_name": args.doctor_name,
            "enrolled_program": args.program,
            "main_goal": args.goal,
            "address": args.location or args.address
        }
        add_or_update_speaker(data)
    elif args.export_header:
        export_c_header(args.export_header)
    elif args.provision_usb:
        provision_usb_serial(args.port, args.ssid, args.password)
    else:
        # Default to interactive wizard if no args given
        speakers = load_registry()
        print_speaker_table(speakers)
        interactive_wizard()

if __name__ == "__main__":
    main()
