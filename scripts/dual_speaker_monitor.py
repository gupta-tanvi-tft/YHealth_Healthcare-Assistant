# -*- coding: utf-8 -*-
"""
Dual Hardware Speaker Unified Serial Monitor
============================================
Runs SPK-02 and SPK-03 simultaneously in ONE terminal window on ONE local backend.
Color-codes output by Device ID so you can see both speakers logging in real time.
"""

import sys
import time
import threading
import re
import serial
import serial.tools.list_ports

# Color formatting for terminal
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"
DIM = "\033[2m"

KNOWN_MAPPING = {
    "28:84:85:B2:BC:B8": {"id": "SPK-02", "name": "Dr. Makkar (Desk)", "color": CYAN},
    "28:84:85:B2:BB:C8": {"id": "SPK-03", "name": "Dr. Makkar (Exam)", "color": GREEN},
    "288485B2BCB8": {"id": "SPK-02", "name": "Dr. Makkar (Desk)", "color": CYAN},
    "288485B2BBC8": {"id": "SPK-03", "name": "Dr. Makkar (Exam)", "color": GREEN},
}

running = True

def monitor_port(port_name, fallback_label, color_code):
    global running
    try:
        ser = serial.Serial(port=port_name, baudrate=115200, timeout=1.0)
        print(f"{color_code}{BOLD}[MONITOR ONLINE]{RESET} Listening on {port_name} as {fallback_label}...")
    except Exception as e:
        print(f"\033[91m[ERROR] Could not open {port_name}: {e}{RESET}")
        return

    label = fallback_label
    current_color = color_code

    while running:
        try:
            line_bytes = ser.readline()
            if not line_bytes:
                continue
            line = line_bytes.decode('utf-8', errors='replace').rstrip('\r\n')
            if not line:
                continue

            # Auto-detect MAC in boot log
            mac_match = re.search(r"([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})", line)
            if mac_match:
                mac_found = mac_match.group(0).upper().replace("-", ":")
                if mac_found in KNOWN_MAPPING:
                    info = KNOWN_MAPPING[mac_found]
                    label = f"{info['id']} | {info['name']}"
                    current_color = info['color']

            # Check raw hex mac in logs like "Device reconnect identity: 288485b2bcb8"
            raw_match = re.search(r"identity:\s*([0-9a-fA-F]{12})", line)
            if raw_match:
                raw_mac = raw_match.group(1).upper()
                if raw_mac in KNOWN_MAPPING:
                    info = KNOWN_MAPPING[raw_mac]
                    label = f"{info['id']} | {info['name']}"
                    current_color = info['color']

            timestamp = time.strftime("%H:%M:%S")
            print(f"{DIM}{timestamp}{RESET} {current_color}{BOLD}[{label}]{RESET} {line}")
            sys.stdout.flush()

        except serial.SerialException:
            print(f"{current_color}[DISCONNECTED]{RESET} {port_name} disconnected.")
            break
        except Exception as e:
            if running:
                print(f"[WARN {port_name}]: {e}")
            break

    try:
        ser.close()
    except Exception:
        pass


def main():
    global running
    print(f"{BOLD}========================================================================={RESET}")
    print(f"{BOLD}    YHealth Dual-Speaker Unified Terminal (SPK-02 & SPK-03)              {RESET}")
    print(f"{BOLD}    Backend: ws://192.168.50.53:8008 • Dashboard: http://localhost:5173  {RESET}")
    print(f"{BOLD}========================================================================={RESET}")

    # Discover ports
    ports = list(serial.tools.list_ports.comports())
    esp_ports = []
    for p in ports:
        desc = (p.description or "") + (p.manufacturer or "")
        # Look for USB Serial or Espressif devices
        if "USB" in desc.upper() or "SERIAL" in desc.upper() or (p.vid == 0x303A):
            esp_ports.append(p.device)

    print(f"Detected {len(esp_ports)} active USB Serial Port(s): {esp_ports}")

    if not esp_ports:
        print("\033[93m[!] No USB ports detected. Please plug in both SPK-02 and SPK-03 via USB.\033[0m")
        return

    threads = []
    colors = [CYAN, GREEN, YELLOW]

    for idx, port in enumerate(esp_ports[:2]):
        color = colors[idx % len(colors)]
        default_label = f"SPK-0{idx+2}"
        t = threading.Thread(target=monitor_port, args=(port, default_label, color), daemon=True)
        t.start()
        threads.append(t)

    print(f"\n{BOLD}Both speakers streaming into this terminal simultaneously. Press Ctrl+C to exit.{RESET}\n")

    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Shutting down dual monitor cleanly...{RESET}")
        running = False
        for t in threads:
            t.join(timeout=1.0)


if __name__ == "__main__":
    main()
