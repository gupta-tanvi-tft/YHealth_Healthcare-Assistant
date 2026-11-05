"""
Quick Clinic Wi-Fi Setup Script
================================
Easily set clinic Wi-Fi credentials on the ESP32 over USB in 2 seconds
WITHOUT recompiling or re-flashing the firmware!

Usage:
    python set_clinic_wifi.py "Clinic_WiFi_SSID" "Clinic_WiFi_Password"
    python set_clinic_wifi.py --port COM3 "Clinic_WiFi_SSID" "Clinic_WiFi_Password"
"""

import sys
import time

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    print("\n[!] 'pyserial' is required. Run: pip install pyserial\n")
    sys.exit(1)


def find_esp32_port():
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        desc = (p.description or "").lower()
        hwid = (p.hwid or "").lower()
        if "ch340" in desc or "cp210" in desc or "uart" in desc or "usb serial" in desc or "espressif" in hwid or "303a" in hwid:
            return p.device
    if ports:
        return ports[0].device
    return None


def main():
    if len(sys.argv) < 3:
        print("\n🏥 YHealth Clinical Assistant — Quick Wi-Fi Setup")
        print("--------------------------------------------------")
        print("Usage: python set_clinic_wifi.py <SSID> <PASSWORD> [--port COM_PORT]")
        print("Example:")
        print("    python set_clinic_wifi.py \"DrMakkar_Clinic\" \"ClinicPass2026\"\n")
        return

    port = None
    args = sys.argv[1:]
    if "--port" in args:
        idx = args.index("--port")
        port = args[idx + 1]
        args = args[:idx] + args[idx + 2:]

    ssid = args[0]
    password = args[1]

    if not port:
        port = find_esp32_port()

    if not port:
        print("❌ Could not automatically detect ESP32 COM port.")
        print("   Please specify manually: python set_clinic_wifi.py \"SSID\" \"PASSWORD\" --port COMx")
        return

    print(f"\n📡 Connecting to ESP32 on {port}...")
    try:
        ser = serial.Serial(port, 115200, timeout=3)
        time.sleep(1.0)
        command = f"SET_WIFI:{ssid}:{password}\n"
        print(f"📤 Sending new Wi-Fi credentials: SSID='{ssid}'...")
        ser.write(command.encode("utf-8"))
        ser.flush()
        
        start = time.time()
        saved = False
        while time.time() - start < 4.0:
            line = ser.readline().decode("utf-8", errors="ignore").strip()
            if "OK:WIFI_SAVED" in line or "WIFI_SAVED" in line:
                saved = True
                break

        ser.close()
        if saved:
            print(f"✅ SUCCESS: Wi-Fi updated! Device is rebooting and connecting to '{ssid}'.\n")
        else:
            print(f"✅ Credentials sent. Device will connect to '{ssid}' on restart.\n")
    except Exception as e:
        print(f"❌ Failed to communicate with ESP32 on {port}: {e}\n")


if __name__ == "__main__":
    main()
