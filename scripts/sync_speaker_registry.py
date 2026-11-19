#!/usr/bin/env python3
"""
Sync Utility for YHealth Speaker Fleet Mapping Registry.
Allows human editing of config/speaker_fleet_registry.json and automatically
syncs updates into web-dashboard/backend/fleet_db.json and PostgreSQL.
"""

import os
import sys
import json
import argparse

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY_FILE = os.path.join(BASE_DIR, "config", "speaker_fleet_registry.json")
FLEET_DB_FILE = os.path.join(BASE_DIR, "web-dashboard", "backend", "fleet_db.json")

def load_registry():
    if not os.path.exists(REGISTRY_FILE):
        print(f"[ERR] Registry file not found at: {REGISTRY_FILE}")
        sys.exit(1)
    with open(REGISTRY_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_registry(data):
    with open(REGISTRY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"[OK] Saved updated master registry: {REGISTRY_FILE}")

def list_speakers():
    reg = load_registry()
    speakers = reg.get("speakers", [])
    print("=" * 86)
    print(f" YHEALTH SPEAKER FLEET MAPPING REGISTRY ({len(speakers)} Units Configured)")
    print("=" * 86)
    print(f"{'DEVICE ID':<10} | {'MAC ADDRESS':<18} | {'ROLE':<8} | {'ASSIGNED PERSON':<28} | {'LOCATION'}")
    print("-" * 86)
    for s in speakers:
        dev_id = s.get("device_id", "N/A")
        mac = s.get("mac_address", "N/A")
        role = s.get("role", "patient")
        name = s.get("name", "Unassigned")
        loc = s.get("bed_location") or s.get("clinic_name") or s.get("notes") or ""
        print(f"{dev_id:<10} | {mac:<18} | {role:<8} | {name:<28} | {loc}")
    print("=" * 86)

def sync_to_fleet_db():
    reg = load_registry()
    speakers = reg.get("speakers", [])
    
    # Save to fleet_db.json
    with open(FLEET_DB_FILE, "w", encoding="utf-8") as f:
        json.dump(speakers, f, indent=2, ensure_ascii=False)
    print(f"[OK] Synced {len(speakers)} speakers to: {FLEET_DB_FILE}")

    # Try sync to Postgres if available
    try:
        sys.path.append(os.path.join(BASE_DIR, "web-dashboard", "backend"))
        import postgres_db
        count = 0
        for s in speakers:
            postgres_db.upsert_speaker(s)
            count += 1
        print(f"[OK] Synced {count} speakers to PostgreSQL database (yhealth_db).")
    except Exception as e:
        print(f"[WARN] Postgres sync skipped (using JSON storage): {e}")

def update_speaker_mac(device_id: str, new_mac: str):
    reg = load_registry()
    speakers = reg.get("speakers", [])
    found = False
    for s in speakers:
        if s.get("device_id", "").upper() == device_id.strip().upper():
            s["mac_address"] = new_mac.strip().upper()
            found = True
            print(f"[OK] Updated {device_id} with new MAC: {new_mac.strip().upper()}")
            break
    if not found:
        print(f"[ERR] Device ID {device_id} not found in registry.")
        return
    save_registry(reg)
    sync_to_fleet_db()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Manage & Sync YHealth Speaker Fleet Registry")
    parser.add_argument("--list", action="store_true", help="List all speaker mappings")
    parser.add_argument("--sync", action="store_true", help="Sync master registry to backend DB & Postgres")
    parser.add_argument("--set-mac", nargs=2, metavar=("DEVICE_ID", "MAC"), help="Update MAC for a device ID")

    args = parser.parse_args()

    if args.list:
        list_speakers()
    elif args.sync:
        sync_to_fleet_db()
    elif args.set_mac:
        update_speaker_mac(args.set_mac[0], args.set_mac[1])
    else:
        list_speakers()
