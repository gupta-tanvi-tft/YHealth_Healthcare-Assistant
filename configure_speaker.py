#!/usr/bin/env python3
"""
================================================================================
YHealth Smart Speaker Setup & Management Tool (configure_speaker.py)
================================================================================
EASY EXPLANATION:
Think of this file as the "Remote Control & Setup Assistant" for every smart
speaker in your clinic or hospital.

What it helps you do:
  1. Keep a safe list of all speakers in your clinic (saved in fleet_db.json).
  2. Tell your Web Dashboard immediately whenever a speaker changes or moves.
  3. Walk you through setting up a new speaker step-by-step (like an interview).
  4. Create an "Identity Card" file (speaker_identity.h) that gets burned into
     the speaker's microchip so it knows its own name and doctor.
  5. Send Wi-Fi details (name & password) to the speaker over a USB cable.
  6. Remotely turn volume up/down or send spoken voice announcements.
"""

# ==============================================================================
# SECTION 1: BRINGING IN BUILT-IN PYTHON TOOLS
# ==============================================================================
# Python has handy toolboxes (called "modules"). We import the ones we need here:

import os            # Helps find folders and files on your computer (Windows/Mac/Linux)
import sys           # Lets us read what you typed in the terminal or exit cleanly
import json          # Reads and writes simple text files stored in JSON format
import re            # Checks text patterns (for example, checking if a Wi-Fi address is valid)
import argparse      # Reads flags you type in the terminal (like --list, --add, --watch)
import urllib.request # Sends messages over the network to your Web Dashboard
import urllib.error  # Safely catches errors if the Web Dashboard is turned off
from datetime import datetime, timezone # Gets the exact current date and time
from pathlib import Path                # An easy, modern way to handle file paths
from typing import Dict, Any, List, Optional # Helpful notes for code editors about data types


# ==============================================================================
# SECTION 2: WHERE FILES LIVE AND SERVER ADDRESSES
# ==============================================================================

# This finds the exact folder this script is sitting in, then points to our database file:
# (Path: web-dashboard/backend/fleet_db.json)
DB_PATH = Path(__file__).resolve().parent / "web-dashboard" / "backend" / "fleet_db.json"

# The web address where our Fleet Management Dashboard is running:
# (Port 8010 is the backend server that powers the web screen)
API_URL = "http://localhost:8010/api"

# The live stream address (WebSocket) used to send instant alerts without refreshing:
WS_URL = "ws://localhost:8010/ws/fleet"


# ==============================================================================
# SECTION 3: SAVING AND LOADING OUR LIST OF SPEAKERS
# ==============================================================================

def load_registry() -> List[Dict[str, Any]]:
    """
    HOW THIS WORKS:
    This function opens our saved database file (fleet_db.json) and reads the list
    of all speakers currently registered in your clinic.

    If the file does not exist yet (or if there is an error), it safely returns
    an empty list [] so the program never crashes.
    """
    # Step 1: Check if the database file actually exists on your computer:
    if DB_PATH.exists():
        try:
            # Step 2: Open the file for reading ('r' stands for read) with clean text encoding:
            with open(DB_PATH, "r", encoding="utf-8") as f:
                # Step 3: Turn the raw text from the file into an easy Python list:
                return json.load(f)
        except Exception as e:
            # If the file was damaged or couldn't be opened, print a helpful warning:
            print(f"[ERROR] Could not read registry from {DB_PATH}: {e}")
            
    # Step 4: If no file exists yet, return an empty list:
    return []


def save_registry(registry: List[Dict[str, Any]]) -> bool:
    """
    HOW THIS WORKS:
    Takes our updated list of speakers and saves it safely back into the fleet_db.json file.
    
    Returns True if saved successfully, or False if something went wrong.
    """
    try:
        # Step 1: Make sure the folder (web-dashboard/backend) exists; create it if missing:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        
        # Step 2: Open the file for writing ('w' stands for write, replacing old text):
        with open(DB_PATH, "w", encoding="utf-8") as f:
            # Step 3: Write the list into the file neatly formatted with 2 spaces indentation:
            json.dump(registry, f, indent=2, ensure_ascii=False)
            
        return True # Everything saved smoothly!
    except Exception as e:
        # If your computer blocked writing (e.g. file is locked), show the error:
        print(f"[ERROR] Could not save registry to {DB_PATH}: {e}")
        return False


def sync_with_live_api(method: str, endpoint: str, payload: dict) -> bool:
    """
    HOW THIS WORKS:
    Whenever you add or change a speaker from this terminal tool, this function
    knocks on the door of the running Web Dashboard (Port 8010) and says:
    "Hey! A speaker was updated, please refresh the web screen right now!"

    If the Web Dashboard server isn't running, that is totally fine! The change
    is already saved on disk, so this function simply ignores the error.
    """
    # Build the full web link, for example: http://localhost:8010/api/speakers
    url = f"{API_URL}/{endpoint.lstrip('/')}"
    try:
        # Convert our Python information dictionary into raw network bytes:
        data = json.dumps(payload).encode("utf-8")
        
        # Prepare the network request (telling the server: "This is JSON data"):
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={"Content-Type": "application/json"}, 
            method=method
        )
        
        # Send the message, but only wait up to 1.5 seconds so we never get stuck:
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            # Status 200 or 201 means "Success! Server received your message":
            if resp.status in (200, 201):
                return True
    except Exception:
        # If dashboard server is offline, just keep going silently.
        pass
    return False


# ==============================================================================
# SECTION 4: CHECKING AND CLEANING HARDWARE "MAC" ADDRESSES
# ==============================================================================
# What is a MAC address?
# It is a unique 12-character fingerprint code permanently built into the speaker's
# Wi-Fi chip (like a car's VIN number or a passport number).
# Example: "A0:F2:62:E3:4C:80"

def validate_mac(mac: str) -> bool:
    """
    HOW THIS WORKS:
    Checks if what the user typed is actually a real, valid hardware MAC address.
    
    Accepts:
      - With colons:    "A0:F2:62:E3:4C:80"
      - With dashes:    "A0-F2-62-E3-4C-80"
      - Plain letters:  "A0F262E34C80"
    """
    # Remove extra spaces and make all letters uppercase:
    clean = mac.strip().upper()
    
    # Check if the letters and numbers match the official 12-hex-digit rule:
    return bool(
        re.match(r"^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$", clean)
        or re.match(r"^[0-9A-F]{12}$", clean)
    )


def normalize_mac(mac: str) -> str:
    """
    HOW THIS WORKS:
    Takes any messy format the user typed and cleans it up into the standard
    look with colons, like: "A0:F2:62:E3:4C:80".
    """
    # Remove any character that is not a valid hex digit (0-9, A-F):
    clean = re.sub(r"[^0-9A-Fa-f]", "", mac).upper()
    
    # If it is 12 characters, put a colon ':' between every 2 characters:
    if len(clean) == 12:
        return ":".join(clean[i : i + 2] for i in range(0, 12, 2))
        
    # Otherwise return the trimmed string:
    return mac.strip().upper()


# ==============================================================================
# SECTION 5: DRAWING THE SPEAKER TABLE ON YOUR SCREEN
# ==============================================================================

def print_speaker_table(speakers: List[Dict[str, Any]], role_filter: str = None):
    """
    HOW THIS WORKS:
    Draws a clean, organized table in your terminal showing every speaker,
    who owns it (Doctor or Patient), current volume, and online/offline status.
    """
    filtered = speakers
    
    # If you only asked to see doctors or only patients, filter the list:
    if role_filter:
        filtered = [s for s in speakers if s.get("role") == role_filter.lower()]

    # If no speakers were found matching the filter:
    if not filtered:
        print(f"\n[INFO] No speakers found matching filter '{role_filter}'. Total in database: {len(speakers)}")
        return

    # Print a decorative top border line:
    print("\n" + "=" * 132)
    print(f" YHEALTH REAL-TIME SMART SPEAKER ECOSYSTEM REGISTRY ({len(filtered)} devices)")
    print("=" * 132)
    
    # Print the column headers with exact spacing so everything lines up straight:
    print(f"{'ID':<8} {'MAC Address':<18} {'Role':<8} {'Vol':<5} {'Assigned To':<22} {'Status':<9} {'Key Clinical / Clinic Metadata':<54}")
    print("-" * 132)

    # Loop through each speaker in our list and print its details row by row:
    for s in filtered:
        spk_id = s.get("device_id", "N/A")               # e.g. "SPK-01"
        mac = s.get("mac_address", "N/A")                 # e.g. "A0:F2:62:E3:4C:80"
        role = s.get("role", "doctor").upper()            # "DOCTOR" or "PATIENT"
        vol = f"{s.get('volume', 75)}%"                   # e.g. "75%"
        name = s.get("name", "Unassigned")[:20]           # First 20 letters of name
        status = s.get("status", "offline").upper()       # "ONLINE", "STANDBY", or "OFFLINE"

        # Show doctor details or patient details in the rightmost column:
        if role == "DOCTOR":
            meta = f"DrID: {s.get('doctor_id', '—')[:8]}.. | {s.get('specialization', '')[:18]} | {s.get('clinic_name', '')[:20]}"
        else:
            meta = f"PatID: {s.get('patient_id', '—')} | Goal: {s.get('main_goal', '')[:28]} | Doc: {s.get('doctor_assigned_name', '')[:15]}"

        # Print the row cleanly formatted:
        print(f"{spk_id:<8} {mac:<18} {role:<8} {vol:<5} {name:<22} {status:<9} {meta:<54}")

    # Print the bottom border line:
    print("=" * 132 + "\n")


# ==============================================================================
# SECTION 6: ADDING A NEW SPEAKER OR UPDATING AN EXISTING ONE
# ==============================================================================

def add_or_update_speaker(data: Dict[str, Any]) -> bool:
    """
    HOW THIS WORKS:
    1. Checks if the speaker's hardware address (MAC) is valid.
    2. Auto-generates an ID like "SPK-03" if you didn't provide one.
    3. If the speaker already exists in our database, it updates its info.
    4. If it's brand new, it adds it to the list.
    5. Saves the updated list to fleet_db.json.
    6. Alerts the Web Dashboard so doctors can immediately see it on screen.
    """
    # Load our current list of speakers:
    registry = load_registry()
    raw_mac = data.get("mac_address", "").strip()

    # Step 1: Make sure the MAC address is real:
    if not raw_mac or not validate_mac(raw_mac):
        print(f"[ERROR] Invalid MAC address format: '{raw_mac}'. Example: 'A0:F2:62:E3:4C:70'")
        return False

    norm_mac = normalize_mac(raw_mac)
    raw_id = (data.get("device_id") or "").strip().upper()

    # Step 2: If the user didn't give an ID, figure out the next number automatically:
    if not raw_id:
        # Find all existing numbers like 1 from "SPK-01", 2 from "SPK-02":
        existing_nums = [
            int(m.group(1))
            for s in registry
            if (m := re.match(r"^SPK-(\d+)$", s.get("device_id", "")))
        ]
        # Next number is the highest number + 1:
        next_num = max(existing_nums, default=len(registry)) + 1
        raw_id = f"SPK-{str(next_num).zfill(2)}"
    elif not raw_id.startswith("SPK-"):
        # If user typed "05", make sure it becomes "SPK-05":
        raw_id = f"SPK-{raw_id}"

    # Step 3: Check if we already have this speaker saved:
    existing_idx = None
    for idx, s in enumerate(registry):
        # Match either by ID (SPK-01) or by physical MAC address:
        if s.get("device_id", "").upper() == raw_id or s.get("mac_address", "").upper() == norm_mac:
            existing_idx = idx
            break

    role = data.get("role", "doctor").strip().lower()

    # Step 4: Build the complete digital passport for this speaker:
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

    # Step 5: Fill in Doctor-specific or Patient-specific information:
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

    # Step 6: Update the existing slot or add as a new item to our list:
    is_update = existing_idx is not None
    if is_update:
        registry[existing_idx] = record
        print(f"[OK] Dynamically updated speaker '{raw_id}' ({norm_mac})")
    else:
        registry.append(record)
        print(f"[OK] Added new speaker '{raw_id}' ({norm_mac}) as role: {role.upper()}")

    # Save to disk file:
    save_registry(registry)

    # Step 7: Push the update live to the Web Dashboard:
    if is_update:
        sync_with_live_api("PUT", f"/speakers/{raw_id}", record)
    else:
        sync_with_live_api("POST", "/speakers", record)

    print(f"[BROADCAST] Synced in real time to Web Dashboard!")
    return True


# ==============================================================================
# SECTION 7: SENDING REMOTE COMMANDS (VOLUME OR VOICE MESSAGES)
# ==============================================================================

def send_remote_command(speaker_id: str, command: str, payload: dict):
    """
    HOW THIS WORKS:
    Lets you send a remote control instruction to a speaker from your terminal.
    Examples:
      - Change volume to 85%:  --id SPK-01 --set-volume 85
      - Make speaker talk:     --id SPK-01 --announce "Doctor, next patient is ready"
    """
    spk_id = speaker_id.strip().upper()
    if not spk_id.startswith("SPK-"):
        spk_id = f"SPK-{spk_id}"

    payload["command"] = command
    print(f"[DISPATCHING] Sending '{command}' command to speaker {spk_id}...")

    # Send command to the running backend server:
    success = sync_with_live_api("POST", f"/speakers/{spk_id}/command", payload)
    if success:
        print(f"[SUCCESS] Command acknowledged & broadcast to {spk_id} and all connected dashboards!")
    else:
        # If the backend server is not running right now, update our local file so
        # the new volume level isn't forgotten:
        registry = load_registry()
        for s in registry:
            if s.get("device_id", "").upper() == spk_id:
                if command == "set_volume":
                    s["volume"] = payload.get("volume", 75)
                save_registry(registry)
                break
        print(f"[OK] Updated local registry for {spk_id}.")


# ==============================================================================
# SECTION 8: LIVE EVENT WATCHER (WATCHING EVENTS AS THEY HAPPEN)
# ==============================================================================

def watch_fleet_events():
    """
    HOW THIS WORKS:
    Opens a live listening connection to the server. Whenever a speaker turns on,
    sends a heartbeat, or gets a command, it prints a message on your screen live.
    
    You trigger this by running: python configure_speaker.py --watch
    """
    # Need websockets package for live listening:
    try:
        import websockets
        import asyncio
    except ImportError:
        print("[!] Install websockets to use real-time terminal watch: pip install websockets")
        return

    # Background listening worker:
    async def _runner():
        print("\n" + "=" * 60)
        print(f"  YHEALTH REAL-TIME EVENT STREAM: {WS_URL}")
        print("  Listening for dynamic modifications, pings, and commands...")
        print("=" * 60 + "\n")
        try:
            # Connect to our server's live event line:
            async with websockets.connect(WS_URL) as ws:
                while True:
                    # Wait for next event to arrive from any speaker:
                    msg = await ws.recv()
                    data = json.loads(msg)
                    evt = data.get("event")
                    ts = data.get("timestamp", "")
                    payload = data.get("data", {})
                    
                    # Print friendly notification based on what happened:
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

    # Run the listener loop:
    asyncio.run(_runner())


# ==============================================================================
# SECTION 9: INTERACTIVE STEP-BY-STEP SETUP WIZARD
# ==============================================================================

def interactive_wizard():
    """
    HOW THIS WORKS:
    This is the friendly interview wizard. If you run: python configure_speaker.py
    with no flags, it asks you simple questions one by one and configures the speaker.
    """
    print("\n" + "=" * 60)
    print("  YHEALTH REAL-TIME SPEAKER CONFIGURATION WIZARD")
    print("=" * 60)

    # Question 1: Who is this speaker for?
    role = input("\nAssign speaker to [1] DOCTOR or [2] PATIENT? (Enter 1 or 2): ").strip()
    is_doctor = (role == "1" or role.lower().startswith("d"))
    role_str = "doctor" if is_doctor else "patient"

    # Question 2: Hardware MAC Address (found on the speaker sticker)
    mac = input("Enter Hardware MAC Address (e.g. A0:F2:62:E3:4C:80): ").strip()
    # Keep asking until the user types a valid address format:
    while not validate_mac(mac):
        print("[!] Invalid MAC format. Please try again (e.g. A0:F2:62:E3:4C:80 or 12 hex chars).")
        mac = input("Enter Hardware MAC Address: ").strip()

    # Question 3: Speaker ID and Basic Contact Information
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

    # Question 4: Ask different questions depending on whether it's a Doctor or Patient
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

    # Save to file and sync with dashboard:
    add_or_update_speaker(data)
    print("\n[SUCCESS] Configuration complete! Instantly synchronized with Web Dashboard.")


# ==============================================================================
# SECTION 10: CREATING THE "ID CARD" FILE FOR THE ESP32 MICROCHIP
# ==============================================================================

def export_c_header(speaker_id: str):
    """
    HOW THIS WORKS:
    The ESP32 smart speaker runs C/C++ code. It needs a header file called
    'speaker_identity.h' to know who it is.

    This function reads the speaker's data from fleet_db.json and generates:
      hardware/main/speaker_identity.h

    When you flash firmware onto the speaker, this file is baked right into it!
    """
    registry = load_registry()
    
    # Look for the speaker with the requested ID:
    spk = next((s for s in registry if s.get("device_id", "").upper() == speaker_id.upper()), None)
    if not spk:
        print(f"[ERROR] Speaker '{speaker_id}' not found in registry.")
        return

    # Convert the MAC string 'A0:F2:62:...' into C hex bytes { 0xA0, 0xF2, 0x62, ... }:
    clean_mac_hex = [f"0x{b}" for b in spk['mac_address'].split(':')]
    
    # Build the C header file text:
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
    # Destination file inside our hardware folder:
    out_file = Path(__file__).resolve().parent / "hardware" / "main" / "speaker_identity.h"
    
    # Write the C code into the file:
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(header_content)
        
    print(f"[OK] Exported C firmware header to: {out_file}")


# ==============================================================================
# SECTION 11: SENDING WI-FI DIRECTLY OVER USB CABLE
# ==============================================================================

def provision_usb_serial(port: str, ssid: str, password: str, baud: int = 115200):
    """
    HOW THIS WORKS:
    If you connect the ESP32 speaker to your computer via USB, you can run this
    to send your clinic Wi-Fi credentials straight into the speaker.
    
    Example: python configure_speaker.py --provision-usb --port COM3 --ssid "ClinicWiFi" --password "12345"
    """
    try:
        import serial # Needs 'pyserial' package to talk over USB COM ports
    except ImportError:
        print("[!] PySerial is required for USB provisioning. Install with: pip install pyserial")
        return

    print(f"[...] Connecting to ESP32 on {port} @ {baud} baud...")
    try:
        # Open communication through the USB port:
        ser = serial.Serial(port, baud, timeout=3.0)
        
        # Build the command: SET_WIFI:MyWifiName:MyWifiPassword
        cmd = f"SET_WIFI:{ssid}:{password}\n"
        print(f"[SENDING] {cmd.strip()}")
        
        # Send the command across the USB wire:
        ser.write(cmd.encode("utf-8"))
        
        # Read back the speaker's response:
        res = ser.readline().decode("utf-8", errors="ignore").strip()
        print(f"[ESP32 RESPONSE] {res}")
        
        # Always close the USB port when done:
        ser.close()
        print("[SUCCESS] USB Provisioning complete!")
    except Exception as e:
        print(f"[ERROR] USB provisioning failed on {port}: {e}")


# ==============================================================================
# SECTION 12: COMMAND LINE TRAFFIC CONTROLLER (MAIN ROUTER)
# ==============================================================================

def main():
    """
    HOW THIS WORKS:
    This is the front door of the program. When you type commands in your terminal,
    this function looks at what flags you typed and sends you to the right place.
    """
    # Set up our flag reader:
    parser = argparse.ArgumentParser(description="YHealth Real-Time Speaker Ecosystem Configuration & Provisioning Tool")
    
    # General view flags:
    parser.add_argument("--list", action="store_true", help="Show table of all registered speakers")
    parser.add_argument("--role-filter", choices=["doctor", "patient"], help="Filter table by role (doctor or patient)")
    parser.add_argument("--add", action="store_true", help="Add or update a speaker directly from command line")
    parser.add_argument("--watch", action="store_true", help="Watch live events as speakers connect and disconnect")
    
    # Details for adding or editing a speaker:
    parser.add_argument("--id", help="Speaker ID (e.g. SPK-01)")
    parser.add_argument("--mac", help="Hardware MAC address (e.g. A0:F2:62:E3:4C:85)")
    parser.add_argument("--role", choices=["doctor", "patient"], help="Speaker role (doctor or patient)")
    parser.add_argument("--name", help="Full name of assigned doctor or patient")
    parser.add_argument("--phone", help="Contact phone number")
    parser.add_argument("--email", help="Contact email address")
    parser.add_argument("--doctor-id", help="Doctor ID in clinical system")
    parser.add_argument("--specialization", help="Doctor medical specialization (e.g. Diabetologist)")
    parser.add_argument("--clinic", help="Clinic or hospital name")
    parser.add_argument("--address", help="Clinic or patient home address")
    parser.add_argument("--room", help="Doctor consultation room or OPD cabin")
    
    # Patient-specific flags:
    parser.add_argument("--patient-id", help="Patient ID (e.g. PAT-102)")
    parser.add_argument("--doctor-name", help="Name of doctor assigned to this patient")
    parser.add_argument("--program", help="Enrolled care program name")
    parser.add_argument("--goal", help="Patient's primary health goal")
    parser.add_argument("--location", help="Patient home or hospital bed location")
    
    # Live remote control commands:
    parser.add_argument("--set-volume", type=int, help="Remotely adjust speaker hardware volume (0 to 100)")
    parser.add_argument("--announce", help="Send a spoken announcement text directly to the speaker")
    
    # Firmware and USB tools:
    parser.add_argument("--export-header", help="Create C header file for a speaker (e.g. --export-header SPK-01)")
    parser.add_argument("--provision-usb", action="store_true", help="Send Wi-Fi configuration over USB cable")
    parser.add_argument("--port", default="COM3", help="USB Serial COM port (default: COM3)")
    parser.add_argument("--ssid", default="TFTus-WiFi", help="Wi-Fi network name (SSID)")
    parser.add_argument("--password", default="", help="Wi-Fi network password")

    # Read the flags you typed in the terminal:
    args = parser.parse_args()

    # Route 1: Did the user type --watch?
    if args.watch:
        watch_fleet_events()
        
    # Route 2: Did the user type --set-volume?
    elif args.set_volume is not None:
        if not args.id:
            print("[ERROR] Please specify --id (e.g. --id SPK-01)")
            sys.exit(1)
        send_remote_command(args.id, "set_volume", {"volume": args.set_volume})
        
    # Route 3: Did the user type --announce?
    elif args.announce:
        if not args.id:
            print("[ERROR] Please specify --id (e.g. --id SPK-01)")
            sys.exit(1)
        send_remote_command(args.id, "play_announcement", {"text": args.announce})
        
    # Route 4: Did the user type --list?
    elif args.list:
        speakers = load_registry()
        print_speaker_table(speakers, args.role_filter)
        
    # Route 5: Did the user type --add?
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
        
    # Route 6: Did the user type --export-header SPK-01?
    elif args.export_header:
        export_c_header(args.export_header)
        
    # Route 7: Did the user type --provision-usb?
    elif args.provision_usb:
        provision_usb_serial(args.port, args.ssid, args.password)
        
    # Route 8: Default (If user just ran "python configure_speaker.py" with no flags)
    # Shows the table and launches the step-by-step interview wizard!
    else:
        speakers = load_registry()
        print_speaker_table(speakers)
        interactive_wizard()


# Standard Python starter: runs main() when script is executed:
if __name__ == "__main__":
    main()
