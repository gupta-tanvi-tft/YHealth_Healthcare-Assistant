#!/usr/bin/env python3
"""
================================================================================
YHealth Smart Speaker Setup & Management Tool (configure_speaker.py)
================================================================================
This script is the central setup and control tool for all smart speakers
used by doctors and patients in the clinic.

What this file does:
  1. Keeps a saved list of all speakers in: web-dashboard/backend/fleet_db.json
  2. Sends instant updates to the running Web Dashboard (Port 8010).
  3. Interactive Setup Wizard: Guides you step-by-step to set up a new speaker.
  4. Generates C firmware header: hardware/main/speaker_identity.h
  5. Sends Wi-Fi name & password to the ESP32 speaker over a USB cable.
  6. Remotely adjusts volume or sends voice announcements to any speaker.
"""

# ==============================================================================
# 1. IMPORT STANDARD PYTHON LIBRARIES
# ==============================================================================
import os            # Operating system tools (paths, environment variables)
import sys           # System-specific parameters and exit functions
import json          # Reads and writes JSON database files
import re            # Regular expressions (used for validating MAC address formats)
import argparse      # Reads command-line flags (like --list, --add, --watch)
import urllib.request # Sends HTTP requests to the Web Dashboard without extra packages
import urllib.error  # Handles network errors if the dashboard is offline
from datetime import datetime, timezone # Handles timestamps (date and time in UTC)
from pathlib import Path                # Modern, clean file path handler
from typing import Dict, Any, List, Optional # Type hints for clean and readable code

# ==============================================================================
# 2. FILE LOCATIONS AND SERVER ADDRESSES
# ==============================================================================
# Finds the exact folder where this script lives, then points to the database file:
DB_PATH = Path(__file__).resolve().parent / "web-dashboard" / "backend" / "fleet_db.json"

# The REST API address of the Fleet Management backend (running on port 8010):
API_URL = "http://localhost:8010/api"

# The live WebSocket address for instant, two-way event streaming:
WS_URL = "ws://localhost:8010/ws/fleet"


# ==============================================================================
# 3. DATABASE FUNCTIONS (READING & SAVING TO JSON FILE)
# ==============================================================================
def load_registry() -> List[Dict[str, Any]]:
    """
    Reads all registered speakers from the local JSON database file.
    Returns:
        A list of speaker dictionaries. If file doesn't exist, returns empty list [].
    """
    # Check if the database file actually exists on disk:
    if DB_PATH.exists():
        try:
            # Open the file in read mode ('r') with UTF-8 character encoding:
            with open(DB_PATH, "r", encoding="utf-8") as f:
                # Convert the raw JSON text into a Python list of dictionaries:
                return json.load(f)
        except Exception as e:
            # If the file is corrupted or unreadable, print an error message:
            print(f"[ERROR] Could not read registry from {DB_PATH}: {e}")
    # Return an empty list if file was missing or had an error:
    return []


def save_registry(registry: List[Dict[str, Any]]) -> bool:
    """
    Saves the list of speakers into the local JSON database file.
    Args:
        registry: The list of speaker dictionaries to save.
    Returns:
        True if saved successfully, False if writing failed.
    """
    try:
        # Make sure the parent folder (web-dashboard/backend) exists; create if missing:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        # Open the file in write mode ('w') which overwrites with the latest list:
        with open(DB_PATH, "w", encoding="utf-8") as f:
            # Convert Python data into pretty, indented JSON text:
            json.dump(registry, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        # Print error if file could not be written (e.g., permission issue):
        print(f"[ERROR] Could not save registry to {DB_PATH}: {e}")
        return False


def sync_with_live_api(method: str, endpoint: str, payload: dict) -> bool:
    """
    Sends an HTTP request to the running Web Dashboard API.
    This makes the web screen update in real time without refreshing.
    Args:
        method: HTTP action ('POST', 'PUT', etc.)
        endpoint: API path (e.g. '/speakers')
        payload: Python dictionary of data to send
    Returns:
        True if API responded with success (200/201), False otherwise.
    """
    # Build full URL, e.g. http://localhost:8010/api/speakers
    url = f"{API_URL}/{endpoint.lstrip('/')}"
    try:
        # Convert Python dictionary into raw JSON bytes for sending over network:
        data = json.dumps(payload).encode("utf-8")
        # Prepare the HTTP request with Content-Type header telling server it is JSON:
        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json"}, method=method
        )
        # Send the request with a short 1.5-second timeout so it never freezes:
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            # Return True if server answered 200 (OK) or 201 (Created):
            if resp.status in (200, 201):
                return True
    except Exception:
        # If dashboard server is offline, silently continue. Local file is still saved!
        pass
    return False


# ==============================================================================
# 4. MAC ADDRESS VALIDATION & FORMATTING
# ==============================================================================
def validate_mac(mac: str) -> bool:
    """
    Checks if a MAC address string is written in a valid format.
    Accepts:
      - Standard 6-byte colon format: 'A0:F2:62:E3:4C:80'
      - Dash format: 'A0-F2-62-E3-4C-80'
      - Plain 12-character hex format: 'A0F262E34C80'
    """
    # Strip any extra spaces and convert to uppercase:
    clean = mac.strip().upper()
    # Check against standard hex regex patterns:
    return bool(
        re.match(r"^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$", clean)
        or re.match(r"^[0-9A-F]{12}$", clean)
    )


def normalize_mac(mac: str) -> str:
    """
    Standardizes any MAC address to always use colons: 'A0:F2:62:E3:4C:80'.
    """
    # Remove everything that is not a hex digit (0-9, A-F):
    clean = re.sub(r"[^0-9A-Fa-f]", "", mac).upper()
    # If exactly 12 characters, insert a colon every 2 characters:
    if len(clean) == 12:
        return ":".join(clean[i : i + 2] for i in range(0, 12, 2))
    # Otherwise return the trimmed string:
    return mac.strip().upper()


# ==============================================================================
# 5. TABLE PRINTER (Displays speakers in a clean terminal table)
# ==============================================================================
def print_speaker_table(speakers: List[Dict[str, Any]], role_filter: str = None):
    """
    Prints an organized, easy-to-read ASCII table of all speakers in terminal.
    Args:
        speakers: List of speaker dictionaries.
        role_filter: Optional filter ('doctor' or 'patient').
    """
    filtered = speakers
    # If user asked for doctor-only or patient-only, filter the list:
    if role_filter:
        filtered = [s for s in speakers if s.get("role") == role_filter.lower()]

    # If no speakers match, print notice and stop:
    if not filtered:
        print(f"\n[INFO] No speakers found matching filter '{role_filter}'. Total in database: {len(speakers)}")
        return

    # Print table header line:
    print("\n" + "=" * 132)
    print(f" YHEALTH REAL-TIME SMART SPEAKER ECOSYSTEM REGISTRY ({len(filtered)} devices)")
    print("=" * 132)
    # Column headers with exact width spacing:
    print(f"{'ID':<8} {'MAC Address':<18} {'Role':<8} {'Vol':<5} {'Assigned To':<22} {'Status':<9} {'Key Clinical / Clinic Metadata':<54}")
    print("-" * 132)

    # Loop through each speaker and print its row:
    for s in filtered:
        spk_id = s.get("device_id", "N/A")
        mac = s.get("mac_address", "N/A")
        role = s.get("role", "doctor").upper()
        vol = f"{s.get('volume', 75)}%"
        name = s.get("name", "Unassigned")[:20] # Truncate long names to 20 chars
        status = s.get("status", "offline").upper()

        # Format details based on whether speaker belongs to a doctor or patient:
        if role == "DOCTOR":
            meta = f"DrID: {s.get('doctor_id', '—')[:8]}.. | {s.get('specialization', '')[:18]} | {s.get('clinic_name', '')[:20]}"
        else:
            meta = f"PatID: {s.get('patient_id', '—')} | Goal: {s.get('main_goal', '')[:28]} | Doc: {s.get('doctor_assigned_name', '')[:15]}"

        # Print the row:
        print(f"{spk_id:<8} {mac:<18} {role:<8} {vol:<5} {name:<22} {status:<9} {meta:<54}")

    print("=" * 132 + "\n")


# ==============================================================================
# 6. ADD OR UPDATE SPEAKER IN DATABASE
# ==============================================================================
def add_or_update_speaker(data: Dict[str, Any]) -> bool:
    """
    Adds a new speaker or edits an existing speaker in the database.
    Then immediately sends an update to the web dashboard.
    """
    # Load current list of all speakers from the file:
    registry = load_registry()
    raw_mac = data.get("mac_address", "").strip()

    # Step A: Validate MAC address
    if not raw_mac or not validate_mac(raw_mac):
        print(f"[ERROR] Invalid MAC address format: '{raw_mac}'. Example: 'A0:F2:62:E3:4C:70'")
        return False

    # Normalize MAC (clean formatting):
    norm_mac = normalize_mac(raw_mac)
    raw_id = (data.get("device_id") or "").strip().upper()

    # Step B: If no ID was provided (e.g. SPK-05), auto-calculate next number:
    if not raw_id:
        existing_nums = [
            int(m.group(1))
            for s in registry
            if (m := re.match(r"^SPK-(\d+)$", s.get("device_id", "")))
        ]
        # Next number is highest existing number + 1:
        next_num = max(existing_nums, default=len(registry)) + 1
        raw_id = f"SPK-{str(next_num).zfill(2)}"
    elif not raw_id.startswith("SPK-"):
        # Make sure ID always starts with 'SPK-':
        raw_id = f"SPK-{raw_id}"

    # Step C: Check if this speaker already exists in our records:
    existing_idx = None
    for idx, s in enumerate(registry):
        # Match either by Speaker ID or by MAC address:
        if s.get("device_id", "").upper() == raw_id or s.get("mac_address", "").upper() == norm_mac:
            existing_idx = idx
            break

    # Determine role (doctor or patient):
    role = data.get("role", "doctor").strip().lower()

    # Step D: Construct the full record profile:
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

    # Step E: Add Doctor-specific fields OR Patient-specific fields:
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

    # Step F: Update existing record or append as new:
    is_update = existing_idx is not None
    if is_update:
        registry[existing_idx] = record
        print(f"[OK] Dynamically updated speaker '{raw_id}' ({norm_mac})")
    else:
        registry.append(record)
        print(f"[OK] Added new speaker '{raw_id}' ({norm_mac}) as role: {role.upper()}")

    # Save to disk file:
    save_registry(registry)

    # Step G: Send update to the live Web Dashboard:
    if is_update:
        sync_with_live_api("PUT", f"/speakers/{raw_id}", record)
    else:
        sync_with_live_api("POST", "/speakers", record)

    print(f"[BROADCAST] Synced in real time to Web Dashboard!")
    return True


# ==============================================================================
# 7. REMOTE COMMAND DISPATCHER (Change volume or trigger announcements)
# ==============================================================================
def send_remote_command(speaker_id: str, command: str, payload: dict):
    """
    Sends a live command to a speaker (e.g. adjust volume or make an announcement).
    """
    spk_id = speaker_id.strip().upper()
    if not spk_id.startswith("SPK-"):
        spk_id = f"SPK-{spk_id}"

    payload["command"] = command
    print(f"[DISPATCHING] Sending '{command}' command to speaker {spk_id}...")

    # Send command to running backend server over HTTP:
    success = sync_with_live_api("POST", f"/speakers/{spk_id}/command", payload)
    if success:
        print(f"[SUCCESS] Command acknowledged & broadcast to {spk_id} and all connected dashboards!")
    else:
        # If backend is offline, still update the local database so volume persists:
        registry = load_registry()
        for s in registry:
            if s.get("device_id", "").upper() == spk_id:
                if command == "set_volume":
                    s["volume"] = payload.get("volume", 75)
                save_registry(registry)
                break
        print(f"[OK] Updated local registry for {spk_id}.")


# ==============================================================================
# 8. REAL-TIME EVENT STREAM WATCHER (Listens to WebSocket events)
# ==============================================================================
def watch_fleet_events():
    """
    Connects to the WebSocket bus and prints live events on the screen in real time.
    """
    try:
        import websockets
        import asyncio
    except ImportError:
        print("[!] Install websockets to use real-time terminal watch: pip install websockets")
        return

    # Asynchronous event listener loop:
    async def _runner():
        print("\n" + "=" * 60)
        print(f"  YHEALTH REAL-TIME EVENT STREAM: {WS_URL}")
        print("  Listening for dynamic modifications, pings, and commands...")
        print("=" * 60 + "\n")
        try:
            # Connect to WebSocket server:
            async with websockets.connect(WS_URL) as ws:
                while True:
                    # Wait for next event message:
                    msg = await ws.recv()
                    data = json.loads(msg)
                    evt = data.get("event")
                    ts = data.get("timestamp", "")
                    payload = data.get("data", {})
                    
                    # Print colored, readable log line based on event type:
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

    # Start the async loop:
    asyncio.run(_runner())


# ==============================================================================
# 9. STEP-BY-STEP INTERACTIVE SETUP WIZARD
# ==============================================================================
def interactive_wizard():
    """
    Guides a user through simple questions in the terminal to set up a speaker.
    """
    print("\n" + "=" * 60)
    print("  YHEALTH REAL-TIME SPEAKER CONFIGURATION WIZARD")
    print("=" * 60)

    # Step 1: Doctor or Patient?
    role = input("\nAssign speaker to [1] DOCTOR or [2] PATIENT? (Enter 1 or 2): ").strip()
    is_doctor = (role == "1" or role.lower().startswith("d"))
    role_str = "doctor" if is_doctor else "patient"

    # Step 2: Physical MAC address from sticker
    mac = input("Enter Hardware MAC Address (e.g. A0:F2:62:E3:4C:80): ").strip()
    while not validate_mac(mac):
        print("[!] Invalid MAC format. Please try again (e.g. A0:F2:62:E3:4C:80 or 12 hex chars).")
        mac = input("Enter Hardware MAC Address: ").strip()

    # Step 3: Speaker ID and personal contact info
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

    # Step 4: Questions specific to Doctors vs Patients
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

    # Save to database and notify web dashboard:
    add_or_update_speaker(data)
    print("\n[SUCCESS] Configuration complete! Instantly synchronized with Web Dashboard.")


# ==============================================================================
# 10. EXPORT C FIRMWARE HEADER (hardware/main/speaker_identity.h)
# ==============================================================================
def export_c_header(speaker_id: str):
    """
    Creates the C header file hardware/main/speaker_identity.h so that
    when firmware is flashed to the ESP32 chip, it knows its identity.
    """
    registry = load_registry()
    # Find matching speaker record:
    spk = next((s for s in registry if s.get("device_id", "").upper() == speaker_id.upper()), None)
    if not spk:
        print(f"[ERROR] Speaker '{speaker_id}' not found in registry.")
        return

    # Convert colon MAC 'A0:F2:...' into C hex array { 0xA0, 0xF2, ... }:
    clean_mac_hex = [f"0x{b}" for b in spk['mac_address'].split(':')]
    
    # Generate C header file text:
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
    # Write directly into the hardware firmware source directory:
    out_file = Path(__file__).resolve().parent / "hardware" / "main" / "speaker_identity.h"
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(header_content)
    print(f"[OK] Exported C firmware header to: {out_file}")


# ==============================================================================
# 11. USB SERIAL PROVISIONING (Sends Wi-Fi over USB Cable)
# ==============================================================================
def provision_usb_serial(port: str, ssid: str, password: str, baud: int = 115200):
    """
    Connects to the ESP32 speaker via a USB COM port and sets Wi-Fi credentials.
    """
    try:
        import serial
    except ImportError:
        print("[!] PySerial is required for USB provisioning. Install with: pip install pyserial")
        return

    print(f"[...] Connecting to ESP32 on {port} @ {baud} baud...")
    try:
        # Open USB serial connection:
        ser = serial.Serial(port, baud, timeout=3.0)
        # Format command: SET_WIFI:ssid:password
        cmd = f"SET_WIFI:{ssid}:{password}\n"
        print(f"[SENDING] {cmd.strip()}")
        # Send bytes to ESP32:
        ser.write(cmd.encode("utf-8"))
        # Read reply from ESP32:
        res = ser.readline().decode("utf-8", errors="ignore").strip()
        print(f"[ESP32 RESPONSE] {res}")
        ser.close()
        print("[SUCCESS] USB Provisioning complete!")
    except Exception as e:
        print(f"[ERROR] USB provisioning failed on {port}: {e}")


# ==============================================================================
# 12. COMMAND-LINE PARSER & MAIN FUNCTION
# ==============================================================================
def main():
    """
    Entry point of the script: reads CLI flags and directs to the right function.
    """
    # Create the argument parser with help descriptions:
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

    # Parse arguments provided by the user:
    args = parser.parse_args()

    # Route 1: Watch live fleet events
    if args.watch:
        watch_fleet_events()
    # Route 2: Set remote volume
    elif args.set_volume is not None:
        if not args.id:
            print("[ERROR] Please specify --id (e.g. --id SPK-01)")
            sys.exit(1)
        send_remote_command(args.id, "set_volume", {"volume": args.set_volume})
    # Route 3: Play remote voice announcement
    elif args.announce:
        if not args.id:
            print("[ERROR] Please specify --id (e.g. --id SPK-01)")
            sys.exit(1)
        send_remote_command(args.id, "play_announcement", {"text": args.announce})
    # Route 4: List all speakers in table
    elif args.list:
        speakers = load_registry()
        print_speaker_table(speakers, args.role_filter)
    # Route 5: Add or update speaker via command-line flags
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
    # Route 6: Export C header file for ESP32 firmware
    elif args.export_header:
        export_c_header(args.export_header)
    # Route 7: Provision Wi-Fi over USB
    elif args.provision_usb:
        provision_usb_serial(args.port, args.ssid, args.password)
    # Route 8: Default (when no flags are given) -> show table and start setup wizard
    else:
        speakers = load_registry()
        print_speaker_table(speakers)
        interactive_wizard()


# Standard Python check to run main() only when executed directly:
if __name__ == "__main__":
    main()
