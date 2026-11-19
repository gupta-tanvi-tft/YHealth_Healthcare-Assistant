#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YHealth Speaker Wi-Fi & Hardware Mapping Manager
=================================================
Automated mapping tool to link:
    Device ID <---> MAC Address <---> 1cm QR Code <---> Wi-Fi Status

Usage:
  1. Show current mapping status of all 20 units:
     python scripts/pair_speaker_wifi.py --status

  2. Bind incoming speaker on Wi-Fi connection:
     python scripts/pair_speaker_wifi.py --connect SPK-02 --mac "A0:F2:62:E3:4C:71" --ip "192.168.50.97"

  3. Auto-pair next available device slot by MAC:
     python scripts/pair_speaker_wifi.py --auto-pair "A0:F2:62:E3:4C:71"

  4. Assign Name & Persona later on:
     python scripts/pair_speaker_wifi.py --assign SPK-02 --name "Dr. Brij Mohan Makkar" --persona "doctor_endocrinologist"
"""

import os
import sys
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MAPPING_FILE = BASE_DIR / "config" / "speaker_device_mapping.json"
QR_DIR = BASE_DIR / "speaker_qr_codes"

def load_mappings() -> dict:
    if not MAPPING_FILE.exists():
        print(f"[ERR] Mapping file not found: {MAPPING_FILE}")
        sys.exit(1)
    with open(MAPPING_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_mappings(data: dict):
    data["last_updated"] = datetime.now(timezone.utc).isoformat()
    with open(MAPPING_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"[SAVED] Updated mapping file: {MAPPING_FILE}")

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

def print_status_table():
    data = load_mappings()
    mappings = data.get("mappings", [])

    print("\n" + "=" * 98)
    print(" YHEALTH SMART SPEAKER FLEET: HARDWARE MAPPING REGISTRY (20 SLOTS)")
    print(" Exact 1cm QR Code <---> Automatic Device ID <---> MAC Address <---> Wi-Fi State")
    print("=" * 98)
    print(f"{'SLOT':<6}{'DEVICE ID':<11}{'MAC ADDRESS':<20}{'WI-FI STATE':<18}{'ASSIGNED NAME':<24}{'PERSONA':<18}")
    print("-" * 98)

    for item in mappings:
        slot = f"[{item.get('slot', 0):02d}]"
        dev_id = item.get("device_id", "???")
        mac = item.get("mac_address") or "PENDING"
        wifi = item.get("wifi_status", "awaiting")
        name = item.get("assigned_name") or "(To be assigned)"
        persona = item.get("persona") or "(To be assigned)"

        status_flag = "[ONLINE]" if wifi == "configured" else "[AWAITING WI-FI]" if "pending" in wifi else "[READY]"
        print(f"{slot:<6}{dev_id:<11}{mac:<20}{status_flag:<18}{name[:22]:<24}{persona[:16]:<18}")

    print("=" * 98)
    print(f"Total Slots: {len(mappings)} | 1cm QR Directory: {QR_DIR.relative_to(BASE_DIR)}")
    print("Connect Wi-Fi to auto-bind MAC: python scripts/pair_speaker_wifi.py --connect <ID> --mac <MAC>\n")

def connect_speaker(device_id: str, mac_address: str, ip_address: str = None, ssid: str = "TFTus-WiFi"):
    clean_id = device_id.strip().upper()
    clean_mac = mac_address.strip().upper()

    data = load_mappings()
    mappings = data.get("mappings", [])

    target = None
    for item in mappings:
        if item.get("device_id") == clean_id:
            target = item
            break

    if not target:
        print(f"[ERR] Device ID '{clean_id}' not found in mapping registry.")
        sys.exit(1)

    target["mac_address"] = clean_mac
    target["wifi_status"] = "configured"
    target["wifi_ssid"] = ssid
    if ip_address:
        target["ip_address"] = ip_address
    target["status"] = "active"
    target["qr_payload"]["mac"] = clean_mac
    target["notes"] = f"Connected via Wi-Fi SSID '{ssid}' on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

    save_mappings(data)
    print(f"✅ Successfully mapped {clean_id} <---> MAC: {clean_mac} <---> QR: {target['qr_code_file']}")

def auto_pair(mac_address: str, ip_address: str = None, ssid: str = "TFTus-WiFi"):
    clean_mac = mac_address.strip().upper()
    data = load_mappings()
    mappings = data.get("mappings", [])

    # Check if already mapped
    for item in mappings:
        if item.get("mac_address") == clean_mac:
            print(f"[INFO] MAC {clean_mac} already mapped to {item.get('device_id')}!")
            item["wifi_status"] = "configured"
            if ip_address:
                item["ip_address"] = ip_address
            save_mappings(data)
            return

    # Find next pending slot
    for item in mappings:
        if item.get("wifi_status") in ("pending_wifi_handshake", "awaiting_wifi"):
            dev_id = item.get("device_id")
            connect_speaker(dev_id, clean_mac, ip_address, ssid)
            return

    print("[WARN] All 20 slots already mapped. Please allocate additional slots.")

def assign_persona(device_id: str, name: str, persona: str):
    clean_id = device_id.strip().upper()
    data = load_mappings()
    mappings = data.get("mappings", [])

    target = None
    for item in mappings:
        if item.get("device_id") == clean_id:
            target = item
            break

    if not target:
        print(f"[ERR] Device ID '{clean_id}' not found.")
        sys.exit(1)

    target["assigned_name"] = name
    target["persona"] = persona
    save_mappings(data)
    print(f"✅ Successfully assigned {clean_id} -> Name: '{name}' | Persona: '{persona}'")

def main():
    parser = argparse.ArgumentParser(description="YHealth Speaker Hardware & Wi-Fi Mapping Manager")
    parser.add_argument("--status", action="store_true", help="Print table of all 20 mapped hardware slots")
    parser.add_argument("--connect", type=str, help="Device ID to bind (e.g. SPK-02)")
    parser.add_argument("--mac", type=str, help="Hardware MAC address (e.g. A0:F2:62:E3:4C:71)")
    parser.add_argument("--ip", type=str, help="Local IP address assigned via Wi-Fi DHCP")
    parser.add_argument("--ssid", type=str, default="TFTus-WiFi", help="Wi-Fi SSID")
    parser.add_argument("--auto-pair", type=str, help="Auto-pair next available device slot with this MAC")
    parser.add_argument("--assign", type=str, help="Assign name and persona to Device ID (e.g. SPK-02)")
    parser.add_argument("--name", type=str, help="Assigned doctor/patient person name")
    parser.add_argument("--persona", type=str, help="Clinical persona type")

    args = parser.parse_args()

    if args.status or len(sys.argv) == 1:
        print_status_table()
    elif args.connect and args.mac:
        connect_speaker(args.connect, args.mac, args.ip, args.ssid)
    elif args.auto_pair:
        auto_pair(args.auto_pair, args.ip, args.ssid)
    elif args.assign and (args.name or args.persona):
        assign_persona(args.assign, args.name or "(Unassigned)", args.persona or "(Default)")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
