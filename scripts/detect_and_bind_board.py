#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YHealth Audio Board Auto-Detector & MAC Identification Tool
============================================================
Plugs into ESP32-S3 USB Serial or listens on local Wi-Fi to:
 1. Instantly read the board's permanent factory eFuse MAC Address.
 2. Bind it to the designated Device ID (SPK-01 to SPK-05).
 3. Regenerate the physical 1cm QR code with its real hardware MAC.
 4. Update the central speaker_device_mapping.json file.

Usage:
  python scripts/detect_and_bind_board.py
"""

import os
import sys
import time
import json
import subprocess
import urllib.request
import urllib.parse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MAPPING_FILE = BASE_DIR / "config" / "speaker_device_mapping.json"
QR_DIR = BASE_DIR / "speaker_qr_codes"

try:
    import serial.tools.list_ports
except ImportError:
    print("[ERR] pyserial not available.")
    sys.exit(1)

def get_connected_ports():
    return [p.device for p in serial.tools.list_ports.comports()]

def read_mac_from_port(port: str) -> str:
    """Uses esptool to query the permanent eFuse factory MAC address of ESP32-S3."""
    print(f"\n[QUERY] Connecting to ESP32-S3 on {port} to read factory eFuse MAC...")
    cmd = [sys.executable, "-m", "esptool", "--port", port, "read_mac"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
        out = res.stdout + res.stderr
        for line in out.splitlines():
            if "MAC:" in line:
                # Example: MAC: a0:f2:62:e3:4c:70
                parts = line.split("MAC:")
                if len(parts) > 1:
                    raw_mac = parts[1].strip().split()[0].upper()
                    # Format as standard AA:BB:CC:DD:EE:FF
                    return raw_mac
    except Exception as e:
        print(f"[ERR] Error reading MAC from {port}: {e}")
    return None

def update_mapping_and_qr(device_id: str, real_mac: str, port: str = None):
    if not MAPPING_FILE.exists():
        print(f"[ERR] Mapping file not found: {MAPPING_FILE}")
        return

    with open(MAPPING_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    target = None
    for item in data.get("mappings", []):
        if item.get("device_id") == device_id:
            target = item
            break

    if not target:
        print(f"[ERR] Device ID {device_id} not found in mappings.")
        return

    target["mac_address"] = real_mac
    target["status"] = "active"
    target["wifi_status"] = "hardware_identified"
    if port:
        target["com_port"] = port
    target["qr_payload"]["mac"] = real_mac
    target["notes"] = f"Hardware MAC identified via USB {port or 'Wi-Fi'} at {time.strftime('%Y-%m-%d %H:%M:%S')}"

    # Regenerate 1cm QR Code with real MAC
    payload_str = json.dumps({"id": device_id, "mac": real_mac, "role": target.get("role", "patient")}, separators=(',', ':'))
    encoded_data = urllib.parse.quote(payload_str)
    qr_api_url = f"https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=1&data={encoded_data}"
    
    img_filename = f"{device_id}_QR.png"
    img_path = QR_DIR / img_filename
    try:
        req = urllib.request.Request(qr_api_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            with open(img_path, 'wb') as out_f:
                out_f.write(resp.read())
        print(f"✅ Generated fresh 1cm QR code image: {img_path}")
    except Exception as e:
        print(f"[WARN] Could not update QR image online: {e}")

    with open(MAPPING_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*72}")
    print(f"🎉 SUCCESS! BOARD IDENTIFIED & MAPPED:")
    print(f"   • Assigned Slot: {device_id}")
    print(f"   • Factory Hardware MAC: {real_mac}")
    print(f"   • COM Port: {port or 'Wi-Fi'}")
    print(f"   • Physical 1cm QR Code: {img_filename}")
    print(f"   • Name & Persona: (Will be assigned later by you)")
    print(f"{'='*72}\n")

def main():
    print("\n" + "=" * 72)
    print(" YHEALTH ESP32-S3 AUDIO BOARD HARDWARE IDENTIFIER")
    print(" Connect your 5 boards (1 old + 4 new) one by one via USB-C")
    print("=" * 72)

    device_slots = ["SPK-01", "SPK-02", "SPK-03", "SPK-04", "SPK-05"]

    print("\nReady! Which board are you connecting right now?")
    for idx, slot in enumerate(device_slots, 1):
        label = "Old Board (Dr. Makkar)" if idx == 1 else f"New Board #{idx-1}"
        print(f"  [{idx}] {slot} - {label}")

    initial_ports = get_connected_ports()
    print(f"\nCurrently connected COM ports: {initial_ports if initial_ports else 'None'}")
    print("\n⚡ Waiting for you to plug in an audio board via USB-C...")
    print("   (Plug in the board now. The script will detect it automatically.)\n")

    try:
        last_ports = set(initial_ports)
        while True:
            current_ports = set(get_connected_ports())
            new_ports = current_ports - last_ports

            if new_ports:
                detected_port = list(new_ports)[0]
                print(f"\n🔔 [DETECTED] New USB Audio Board plugged into {detected_port}!")
                time.sleep(1.5)  # Wait for USB enumeration to stabilize

                mac = read_mac_from_port(detected_port)
                if mac:
                    print(f"📌 Permanent Hardware MAC: {mac}")
                    
                    # Ask or auto-select slot
                    slot_choice = input(f"\nAssign this board to which slot? [1=SPK-01, 2=SPK-02, 3=SPK-03, 4=SPK-04, 5=SPK-05] (Default: 2): ").strip()
                    if not slot_choice:
                        target_slot = "SPK-02"
                    else:
                        try:
                            idx = int(slot_choice)
                            target_slot = device_slots[idx - 1]
                        except Exception:
                            target_slot = slot_choice.upper()

                    update_mapping_and_qr(target_slot, mac, detected_port)
                    print("\nReady for the next board! Unplug this one and connect the next board, or press Ctrl+C when done.")
                else:
                    print(f"[ERR] Could not read MAC from {detected_port}. Please check cable or try again.")

            last_ports = current_ports
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\n[STOPPED] Auto-detection completed.")

if __name__ == "__main__":
    main()
