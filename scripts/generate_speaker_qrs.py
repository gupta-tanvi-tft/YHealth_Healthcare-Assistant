# -*- coding: utf-8 -*-
import os
import json
import urllib.parse
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FLEET_DB_PATH = os.path.join(BASE_DIR, "..", "web-dashboard", "backend", "fleet_db.json")
OUTPUT_DIR = os.path.join(BASE_DIR, "..", "speaker_qr_codes")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 1. Load speakers from fleet_db.json if available
speakers = []
if os.path.exists(FLEET_DB_PATH):
    try:
        with open(FLEET_DB_PATH, "r", encoding="utf-8") as f:
            speakers = json.load(f)
            print(f"[OK] Loaded {len(speakers)} speakers from {FLEET_DB_PATH}")
    except Exception as e:
        print(f"[WARN] Error reading fleet_db.json: {e}")

# If empty or fewer than 20, expand automatically up to 20 units
default_speakers = [
    {
        "device_id": "SPK-01",
        "mac_address": "A0:F2:62:E3:4C:70",
        "role": "doctor",
        "name": "Dr. Brij Mohan Makkar",
        "clinic_name": "Dr. Makkar's Diabetes & Obesity Centre",
        "wifi_ssid": "TFTus-WiFi"
    },
    {
        "device_id": "SPK-02",
        "mac_address": "A0:F2:62:E3:4C:71",
        "role": "doctor",
        "name": "Dr. Brij Mohan Makkar (Suite 2 / Home)",
        "clinic_name": "Consultation Suite 2 / Home Office",
        "wifi_ssid": "TFTus-WiFi"
    },
    {
        "device_id": "SPK-03",
        "mac_address": "A0:F2:62:E3:4C:72",
        "role": "patient",
        "name": "Vijay Gupta Sir",
        "enrolled_program": "Home Bedside Station (Primary)",
        "wifi_ssid": "TFTus-WiFi"
    },
    {
        "device_id": "SPK-04",
        "mac_address": "A0:F2:62:E3:4C:73",
        "role": "patient",
        "name": "Internal Lab Testing Unit",
        "enrolled_program": "Hardware Lab Testbench 1",
        "wifi_ssid": "TFTus-WiFi"
    },
    {
        "device_id": "SPK-05",
        "mac_address": "A0:F2:62:E3:4C:74",
        "role": "patient",
        "name": "Company Field & Partner Testing",
        "enrolled_program": "Executive Demo Lounge",
        "wifi_ssid": "TFTus-WiFi"
    }
]

# Merge fleet_db with defaults if needed
existing_ids = {s.get("device_id") for s in speakers if s.get("device_id")}
for d in default_speakers:
    if d["device_id"] not in existing_ids:
        speakers.append(d)
        existing_ids.add(d["device_id"])

# Ensure at least 20 speaker stickers are ready for upcoming hardware arrival
for i in range(1, 21):
    dev_id = f"SPK-{i:02d}"
    if dev_id not in existing_ids:
        mac_suffix = 0x70 + (i - 1)
        mac_addr = f"A0:F2:62:E3:4C:{mac_suffix:02X}"
        role = "doctor" if i in [1, 2, 8, 12, 16] else "patient"
        speakers.append({
            "device_id": dev_id,
            "mac_address": mac_addr,
            "role": role,
            "name": f"Unassigned Fleet Unit {i:02d}",
            "clinic_name": "Inventory Reserve / Provisioning",
            "enrolled_program": "Care Ready Fleet Reserve",
            "wifi_ssid": "TFTus-WiFi"
        })
        existing_ids.add(dev_id)

# Sort by device_id
speakers.sort(key=lambda x: x.get("device_id", "SPK-99"))

print("=" * 75)
print(f" GENERATING 1CM HARDWARE QR STICKERS FOR {len(speakers)} SPEAKERS")
print("=" * 75)

chassis_stickers_html = []
micro_stickers_html = []

for spk in speakers:
    dev_id = spk.get("device_id", "SPK-??")
    mac = spk.get("mac_address", "00:00:00:00:00:00")
    role = spk.get("role", "patient")
    name = spk.get("name") or spk.get("clinic_name") or "Unassigned"
    
    # 2. Optimized Compact Payload for reliable 1cm physical scanning
    # Low density QR (Version 1/2) is critical for cameras scanning a 10mm target
    qr_payload = {
        "id": dev_id,
        "mac": mac,
        "role": role
    }
    payload_str = json.dumps(qr_payload, separators=(',', ':'))
    encoded_data = urllib.parse.quote(payload_str)
    
    # High resolution PNG for crisp rendering when printed at 1cm (10mm)
    qr_api_url = f"https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=1&data={encoded_data}"
    
    img_filename = f"{dev_id}_QR.png"
    img_path = os.path.join(OUTPUT_DIR, img_filename)
    
    # Download QR code image if not already cached
    if not os.path.exists(img_path) or os.path.getsize(img_path) < 100:
        try:
            req = urllib.request.Request(qr_api_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                with open(img_path, 'wb') as out_f:
                    out_f.write(resp.read())
            print(f"[OK] Downloaded: {img_filename} | ID: {dev_id} | MAC: {mac}")
        except Exception as e:
            print(f"[ERR] Failed fetching QR for {dev_id}: {e}")
    else:
        print(f"[CACHE] Using existing: {img_filename} | ID: {dev_id}")
    
    is_doc = role.lower() == "doctor"
    badge_bg = "#10b981" if is_doc else "#0ea5e9"
    badge_text = "DOCTOR" if is_doc else "PATIENT"

    # FORMAT 1: Chassis Sticker (40mm x 14mm) with 1cm QR on left + Auto Device ID & MAC on right
    chassis_stickers_html.append(f"""
    <div class="chassis-label">
      <div class="qr-col">
        <img src="{img_filename}" alt="{dev_id}" class="qr-1cm" />
      </div>
      <div class="meta-col">
        <div class="top-row">
          <span class="device-tag">{dev_id}</span>
          <span class="role-chip" style="background:{badge_bg};">{badge_text}</span>
        </div>
        <div class="mac-line">{mac}</div>
        <div class="name-line" title="{name}">{name[:22]}</div>
        <div class="model-line">YHealth ESP32-S3</div>
      </div>
    </div>
    """)

    # FORMAT 2: Micro QR Sticker (12mm x 16mm) — 1cm QR with Automatic Device ID below
    micro_stickers_html.append(f"""
    <div class="micro-label">
      <img src="{img_filename}" alt="{dev_id}" class="qr-1cm" />
      <div class="micro-id">{dev_id}</div>
    </div>
    """)

# 3. Create Printable HTML Document with Physical 1cm Sizing
html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>YHealth Hardware QR Stickers (1cm Specification)</title>
  <style>
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      padding: 24px;
    }}

    /* Control Panel (Hidden during Print) */
    .no-print {{
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px 24px;
      max-width: 960px;
      margin: 0 auto 24px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }}
    .no-print h1 {{
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
    }}
    .no-print p {{
      font-size: 12.5px;
      color: #64748b;
      margin-top: 4px;
    }}
    .btn-print {{
      background: linear-gradient(135deg, #0ea5e9, #0284c7);
      color: #ffffff;
      font-weight: 700;
      font-size: 13.5px;
      padding: 10px 22px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(14, 165, 233, 0.35);
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    .btn-print:hover {{
      background: #0284c7;
    }}

    /* Calibration Scale Bar */
    .calibration-bar {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #f1f5f9;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 11px;
      font-family: monospace;
      color: #334155;
    }}
    .ruler-1cm {{
      width: 1cm;
      height: 6px;
      background: #0ea5e9;
      border-left: 2px solid #0284c7;
      border-right: 2px solid #0284c7;
      position: relative;
    }}

    /* Printable Page Container */
    .printable-sheet {{
      background: #ffffff;
      max-width: 210mm; /* A4 Width */
      min-height: 297mm; /* A4 Height */
      margin: 0 auto;
      padding: 12mm 10mm;
      box-shadow: 0 0 20px rgba(0,0,0,0.08);
      border-radius: 8px;
    }}

    .section-title {{
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #475569;
      border-bottom: 1.5px solid #e2e8f0;
      padding-bottom: 6px;
      margin: 16px 0 12px;
    }}

    /* ------------------------------------------------------------- */
    /* EXACT 1CM QR CODE IMAGE SPECIFICATION                        */
    /* ------------------------------------------------------------- */
    .qr-1cm {{
      width: 1cm !important;
      height: 1cm !important;
      min-width: 1cm;
      min-height: 1cm;
      max-width: 1cm;
      max-height: 1cm;
      display: block;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
      image-rendering: pixelated;
    }}

    /* ------------------------------------------------------------- */
    /* FORMAT 1: COMPACT CHASSIS LABEL (42mm x 14mm)                 */
    /* Fits directly on ESP32-S3 Speaker bottom or back chassis      */
    /* ------------------------------------------------------------- */
    .chassis-grid {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 5mm;
      margin-bottom: 20px;
    }}
    .chassis-label {{
      width: 44mm;
      height: 15mm;
      border: 1px dashed #94a3b8;
      border-radius: 3px;
      background: #ffffff;
      padding: 1.5mm;
      display: flex;
      align-items: center;
      gap: 2mm;
      page-break-inside: avoid;
      overflow: hidden;
    }}
    .qr-col {{
      flex-shrink: 0;
      width: 1cm;
      height: 1cm;
    }}
    .meta-col {{
      flex: 1;
      min-width: 0;
      line-height: 1.15;
    }}
    .top-row {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 2px;
    }}
    .device-tag {{
      font-size: 8.5pt;
      font-weight: 900;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #0f172a;
      letter-spacing: -0.02em;
    }}
    .role-chip {{
      font-size: 4.8pt;
      font-weight: 800;
      color: #ffffff;
      padding: 1px 3px;
      border-radius: 2px;
      text-transform: uppercase;
    }}
    .mac-line {{
      font-size: 5pt;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #334155;
      font-weight: 600;
      white-space: nowrap;
    }}
    .name-line {{
      font-size: 5pt;
      color: #475569;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }}
    .model-line {{
      font-size: 4.2pt;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }}

    /* ------------------------------------------------------------- */
    /* FORMAT 2: MICRO QR LABEL (12mm x 16mm)                        */
    /* Ultra-compact for small surface areas or USB-C bevel          */
    /* ------------------------------------------------------------- */
    .micro-grid {{
      display: flex;
      flex-wrap: wrap;
      gap: 4mm;
      margin-bottom: 20px;
    }}
    .micro-label {{
      width: 13mm;
      height: 16mm;
      border: 1px dashed #cbd5e1;
      border-radius: 3px;
      padding: 1mm 1.5mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      page-break-inside: avoid;
      background: #ffffff;
    }}
    .micro-id {{
      font-size: 6.5pt;
      font-weight: 900;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #0f172a;
      margin-top: 1mm;
      text-align: center;
      line-height: 1;
    }}

    /* Print Styles */
    @media print {{
      body {{
        background: #ffffff;
        padding: 0;
      }}
      .no-print {{
        display: none !important;
      }}
      .printable-sheet {{
        box-shadow: none;
        padding: 6mm 4mm;
        margin: 0;
        max-width: 100%;
      }}
      .chassis-label {{
        border: 0.8px dashed #64748b;
      }}
      .micro-label {{
        border: 0.8px dashed #64748b;
      }}
      @page {{
        size: A4 portrait;
        margin: 8mm;
      }}
    }}
  </style>
</head>
<body>

  <!-- Screen-Only Controls Bar -->
  <div class="no-print">
    <div>
      <h1>🏷️ YHealth Smart Speaker Hardware Stickers (1cm QR)</h1>
      <p>Calibrated for exact 10mm (1.0 cm) physical print size with Automatic Device IDs (SPK-01 to SPK-20)</p>
    </div>
    <div style="display: flex; align-items: center; gap: 12px;">
      <div class="calibration-bar">
        <span>Calibration Check:</span>
        <div class="ruler-1cm"></div>
        <span>= 1.0 cm</span>
      </div>
      <button class="btn-print" onclick="window.print()">
        <span>🖨️ Print Labels</span>
      </button>
    </div>
  </div>

  <!-- Printable A4 Sheet -->
  <div class="printable-sheet">
    
    <div class="section-title">
      FORMAT A: Chassis Hardware Label (44mm × 15mm) — 1cm QR + Automatic Device ID & MAC
    </div>
    <div class="chassis-grid">
      {''.join(chassis_stickers_html)}
    </div>

    <div class="section-title" style="margin-top: 24px;">
      FORMAT B: Ultra-Micro QR Stickers (13mm × 16mm) — 1cm QR with Automatic Device ID
    </div>
    <div class="micro-grid">
      {''.join(micro_stickers_html)}
    </div>

  </div>

</body>
</html>
"""

html_filepath = os.path.join(OUTPUT_DIR, "speaker_stickers.html")
with open(html_filepath, "w", encoding="utf-8") as f:
    f.write(html_content)

print(f"\n[SUCCESS] Generated 1cm QR Stickers Sheet: {html_filepath}")
print(f"[SUCCESS] All 20 QR codes saved in: {OUTPUT_DIR}")
