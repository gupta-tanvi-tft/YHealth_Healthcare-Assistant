import os
import json
import urllib.parse
import urllib.request

speakers = [
    {
        "device_id": "SPK-01",
        "mac": "A0:F2:62:E3:4C:70",
        "role": "doctor",
        "name": "Dr. Brij Mohan Makkar",
        "assigned_id": "6789ebb61a093d60fa691c39",
        "loc": "Dr. Makkar's Clinic (Consultation Room 1)",
        "wifi_ssid": "TFTus-WiFi"
    },
    {
        "device_id": "SPK-02",
        "mac": "A0:F2:62:E3:4C:71",
        "role": "doctor",
        "name": "Dr. Brij Mohan Makkar (Suite 2 / Home)",
        "assigned_id": "6789ebb61a093d60fa691c39",
        "loc": "Consultation Suite 2 / Home Office",
        "wifi_ssid": "TFTus-WiFi"
    },
    {
        "device_id": "SPK-03",
        "mac": "A0:F2:62:E3:4C:72",
        "role": "patient",
        "name": "Vijay Gupta Sir",
        "assigned_id": "PAT-VIJAY-01",
        "loc": "Home Bedside Station (Primary)",
        "wifi_ssid": "TFTus-WiFi"
    },
    {
        "device_id": "SPK-04",
        "mac": "A0:F2:62:E3:4C:73",
        "role": "patient",
        "name": "Internal Lab Testing Unit",
        "assigned_id": "PAT-TEST-01",
        "loc": "Hardware Lab Testbench 1",
        "wifi_ssid": "TFTus-WiFi"
    },
    {
        "device_id": "SPK-05",
        "mac": "A0:F2:62:E3:4C:74",
        "role": "patient",
        "name": "Company Field & Partner Testing",
        "assigned_id": "PAT-DEMO-01",
        "loc": "Executive Demo Lounge",
        "wifi_ssid": "TFTus-WiFi"
    }
]

output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "speaker_qr_codes")
os.makedirs(output_dir, exist_ok=True)

print("=" * 70)
print(" GENERATING 5 HARDWARE SPEAKER PROVISIONING QR CODES")
print("=" * 70)

html_cards = []

for spk in speakers:
    dev_id = spk["device_id"]
    payload = {
        "v": 1,
        "device_id": dev_id,
        "mac": spk["mac"],
        "role": spk["role"],
        "name": spk["name"],
        "assigned_id": spk["assigned_id"],
        "location": spk["loc"],
        "wifi_ssid": spk["wifi_ssid"],
        "backend_url": "http://127.0.0.1:8010/api/speakers"
    }

    payload_json = json.dumps(payload, separators=(',', ':'))
    encoded_data = urllib.parse.quote(payload_json)
    qr_api_url = f"https://api.qrserver.com/v1/create-qr-code/?size=320x320&data={encoded_data}"

    img_filename = f"{dev_id}_QR.png"
    img_path = os.path.join(output_dir, img_filename)

    try:
        urllib.request.urlretrieve(qr_api_url, img_path)
        print(f"[OK] Saved: {img_filename} | ID: {dev_id} | MAC: {spk['mac']} | Assigned: {spk['name']}")
    except Exception as e:
        print(f"[ERR] Failed to download QR for {dev_id}: {e}")

    badge_color = "#10b981" if spk["role"] == "doctor" else "#0ea5e9"
    role_title = "DOCTOR CLINICAL UNIT" if spk["role"] == "doctor" else "PATIENT BEDSIDE STATION"

    html_cards.append(f"""
    <div class="sticker-card">
      <div class="card-header" style="border-top: 4px solid {badge_color};">
        <span class="role-badge" style="background: {badge_color};">{role_title}</span>
        <span class="device-id">{dev_id}</span>
      </div>
      <div class="qr-container">
        <img src="{img_filename}" alt="QR Code for {dev_id}" width="220" height="220" />
      </div>
      <div class="card-details">
        <div class="person-name">{spk['name']}</div>
        <div class="info-row"><b>MAC:</b> <span class="mono">{spk['mac']}</span></div>
        <div class="info-row"><b>Assigned ID:</b> <span class="mono">{spk['assigned_id']}</span></div>
        <div class="info-row"><b>Location:</b> {spk['loc']}</div>
      </div>
      <div class="card-footer">
        Scan via Dashboard Webcam for Zero-Touch Pairing
      </div>
    </div>
    """)

# Create Printable HTML Page
html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>YHealth Speaker Fleet - Printable Hardware QR Sticker Badges</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f1f5f9;
      color: #0f172a;
      padding: 30px;
    }}
    .sheet-title {{
      text-align: center;
      margin-bottom: 25px;
    }}
    .sheet-title h1 {{
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
    }}
    .sheet-title p {{
      color: #64748b;
      font-size: 13px;
      margin-top: 5px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }}
    .sticker-card {{
      background: #ffffff;
      border: 1.5px dashed #cbd5e1;
      border-radius: 12px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-shadow: 0 4px 10px rgba(0,0,0,0.04);
      page-break-inside: avoid;
    }}
    .card-header {{
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 6px;
      margin-bottom: 12px;
    }}
    .role-badge {{
      font-size: 9.5px;
      font-weight: 800;
      color: #ffffff;
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.04em;
    }}
    .device-id {{
      font-size: 16px;
      font-weight: 900;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #0f172a;
    }}
    .qr-container {{
      background: #ffffff;
      padding: 8px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 12px;
    }}
    .card-details {{
      width: 100%;
      text-align: left;
      font-size: 11.5px;
      line-height: 1.5;
    }}
    .person-name {{
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }}
    .info-row {{
      color: #475569;
    }}
    .mono {{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      color: #1e293b;
    }}
    .card-footer {{
      margin-top: 10px;
      font-size: 9px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
      text-align: center;
      border-top: 1px solid #f1f5f9;
      padding-top: 8px;
      width: 100%;
    }}
    @media print {{
      body {{ background: #ffffff; padding: 0; }}
      .sheet-title {{ display: none; }}
      .sticker-card {{ box-shadow: none; border: 1px dashed #94a3b8; }}
    }}
  </style>
</head>
<body>
  <div class="sheet-title">
    <h1>YHealth Smart Healthcare Speaker Fleet (5 Units)</h1>
    <p>Printable Hardware Pairing & Webcam Provisioning Badges &bull; Cut along dashed borders</p>
  </div>
  <div class="grid">
    {''.join(html_cards)}
  </div>
</body>
</html>
"""

html_filepath = os.path.join(output_dir, "speaker_stickers.html")
with open(html_filepath, "w", encoding="utf-8") as f:
    f.write(html_content)

print(f"\n[SUCCESS] Generated Printable Sheet: {html_filepath}")
print(f"[SUCCESS] All 5 QR code images saved in: {output_dir}")
