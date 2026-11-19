# -*- coding: utf-8 -*-
"""
YHealth 1cm Hardware QR Generator
Generates:
  1. PNG images with embedded 300 DPI metadata matching exact 1.0 cm (10mm).
  2. PDF file (YHealth_1cm_Speaker_Stickers.pdf) using ReportLab with exact 1.0cm vector boxes.
  3. Physical calibration ruler so you can verify with a plastic ruler on paper.
"""

import os
import sys
import json
import urllib.parse
import urllib.request
from PIL import Image

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm, mm
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False
    print("[WARN] reportlab not installed, skipping PDF generation.")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MAPPING_FILE = os.path.join(BASE_DIR, "..", "config", "speaker_device_mapping.json")
OUTPUT_DIR = os.path.join(BASE_DIR, "..", "speaker_qr_codes")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Load device mappings
with open(MAPPING_FILE, "r", encoding="utf-8") as f:
    mapping_data = json.load(f)

mappings = mapping_data.get("mappings", [])
print(f"[OK] Loaded {len(mappings)} devices from speaker_device_mapping.json")

# 1. Download / Process each QR code image to exact 1cm at 300 DPI (118 x 118 px)
# 1 cm = 0.3937 inches. At 300 DPI: 0.3937 * 300 = 118 px.
TARGET_PX = 118  # Exactly 1.0 cm at 300 DPI
DPI_300 = (300, 300)

processed_qrs = []

for item in mappings:
    dev_id = item.get("device_id")
    mac = item.get("mac_address") or "PENDING"
    role = item.get("role", "patient")
    
    # Low-density compact payload for high scannability at 10mm
    payload = {"id": dev_id, "mac": mac, "role": role}
    payload_str = json.dumps(payload, separators=(',', ':'))
    encoded = urllib.parse.quote(payload_str)
    
    # Fetch sharp 300x300 source QR
    api_url = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=1&data={encoded}"
    raw_png_path = os.path.join(OUTPUT_DIR, f"{dev_id}_raw.png")
    final_png_path = os.path.join(OUTPUT_DIR, f"{dev_id}_QR.png")
    
    # Download clean source if needed
    try:
        req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            with open(raw_png_path, 'wb') as out_f:
                out_f.write(resp.read())
        
        # Open with PIL, resize to exact 118x118 px, and save with 300 DPI metadata
        with Image.open(raw_png_path) as im:
            # Nearest neighbor / box filter ensures sharp pixel grid for QR
            im_resized = im.resize((TARGET_PX, TARGET_PX), Image.Resampling.NEAREST)
            # Save with embedded DPI metadata (300 DPI = exactly 1.0 cm physical print size)
            im_resized.save(final_png_path, "PNG", dpi=DPI_300)
        
        if os.path.exists(raw_png_path):
            os.remove(raw_png_path)
            
        print(f"[1CM PNG] {dev_id}_QR.png -> 118x118 px @ 300 DPI = exactly 1.0 cm")
        processed_qrs.append({
            "device_id": dev_id,
            "mac": mac,
            "role": role,
            "png_path": final_png_path,
            "slot": item.get("slot")
        })
    except Exception as e:
        print(f"[ERR] Failed processing {dev_id}: {e}")

# 2. Generate PDF with Exact Physical 1.0 cm (10mm) Vector Boxes using ReportLab
if REPORTLAB_AVAILABLE:
    pdf_path = os.path.join(OUTPUT_DIR, "YHealth_1cm_Speaker_Stickers.pdf")
    c = canvas.Canvas(pdf_path, pagesize=A4)
    page_w, page_h = A4  # 210mm x 297mm

    # Header
    c.setFont("Helvetica-Bold", 14)
    c.drawString(1.5 * cm, page_h - 1.5 * cm, "YHealth Smart Speaker Fleet — 1.0 cm Hardware QR Stickers")
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.HexColor("#475569"))
    c.drawString(1.5 * cm, page_h - 2.0 * cm, "Calibrated to exact 1.0 cm x 1.0 cm (10mm x 10mm). Print at 100% scale (Do not fit to page).")

    # 1.0 cm Calibration Ruler to let the user check with a physical plastic ruler
    c.setStrokeColor(colors.HexColor("#0284c7"))
    c.setFillColor(colors.HexColor("#0284c7"))
    ruler_x = 1.5 * cm
    ruler_y = page_h - 2.8 * cm
    c.rect(ruler_x, ruler_y, 1.0 * cm, 0.2 * cm, fill=1, stroke=0)
    c.rect(ruler_x + 1.0 * cm, ruler_y, 1.0 * cm, 0.2 * cm, fill=0, stroke=1)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(ruler_x + 2.3 * cm, ruler_y + 0.05 * cm, "<- Calibration Scale: Solid blue box is exactly 1.0 cm wide")

    # Draw Section A: 42mm x 14mm Chassis Stickers (1cm QR on left, details on right)
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#0f172a"))
    c.drawString(1.5 * cm, page_h - 3.6 * cm, "FORMAT A: Chassis Stickers (42mm x 14mm) — 1.0 cm QR on Left + Device ID & MAC on Right")

    start_x = 1.5 * cm
    start_y = page_h - 4.2 * cm
    card_w = 4.4 * cm
    card_h = 1.4 * cm
    gap_x = 0.4 * cm
    gap_y = 0.35 * cm
    cols = 4

    for idx, spk in enumerate(processed_qrs):
        col = idx % cols
        row = idx // cols

        x = start_x + col * (card_w + gap_x)
        y = start_y - row * (card_h + gap_y) - card_h

        # Dashed cut box around sticker
        c.setDash(2, 2)
        c.setStrokeColor(colors.HexColor("#94a3b8"))
        c.setLineWidth(0.5)
        c.roundRect(x, y, card_w, card_h, 2 * mm, fill=0, stroke=1)
        c.setDash([])  # Reset dash

        # Draw QR Code at EXACTLY 1.0 cm x 1.0 cm
        qr_x = x + 0.15 * cm
        qr_y = y + 0.2 * cm
        if os.path.exists(spk["png_path"]):
            c.drawImage(spk["png_path"], qr_x, qr_y, width=1.0 * cm, height=1.0 * cm)

        # Meta text
        meta_x = x + 1.25 * cm
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(colors.HexColor("#0f172a"))
        c.drawString(meta_x, y + 0.95 * cm, spk["device_id"])

        # Role badge
        c.setFont("Helvetica-Bold", 5)
        is_doc = spk["role"] == "doctor"
        c.setFillColor(colors.HexColor("#10b981") if is_doc else colors.HexColor("#0284c7"))
        c.drawString(meta_x + 1.7 * cm, y + 0.95 * cm, "DOCTOR" if is_doc else "PATIENT")

        # MAC Address
        c.setFont("Courier-Bold", 6.5)
        c.setFillColor(colors.HexColor("#334155"))
        c.drawString(meta_x, y + 0.6 * cm, spk["mac"])

        # Hardware Model
        c.setFont("Helvetica", 5.5)
        c.setFillColor(colors.HexColor("#64748b"))
        c.drawString(meta_x, y + 0.3 * cm, "YHealth ESP32-S3")

    # Draw Section B: Ultra-Micro 1cm QR Stickers (1.2cm x 1.5cm)
    sec_b_y = start_y - 5 * (card_h + gap_y) - 1.0 * cm
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#0f172a"))
    c.drawString(1.5 * cm, sec_b_y, "FORMAT B: Ultra-Micro Stickers (12mm x 15mm) — 1.0 cm QR with Device ID Below")

    micro_w = 1.3 * cm
    micro_h = 1.6 * cm
    micro_gap_x = 0.35 * cm
    micro_gap_y = 0.35 * cm
    micro_start_y = sec_b_y - 0.4 * cm

    for idx, spk in enumerate(processed_qrs):
        col = idx % 10
        row = idx // 10

        x = start_x + col * (micro_w + micro_gap_x)
        y = micro_start_y - row * (micro_h + micro_gap_y) - micro_h

        # Dashed cut box
        c.setDash(1.5, 1.5)
        c.setStrokeColor(colors.HexColor("#cbd5e1"))
        c.setLineWidth(0.4)
        c.roundRect(x, y, micro_w, micro_h, 1.5 * mm, fill=0, stroke=1)
        c.setDash([])

        # QR Code at exactly 1.0 cm x 1.0 cm
        qr_x = x + 0.15 * cm
        qr_y = y + 0.45 * cm
        if os.path.exists(spk["png_path"]):
            c.drawImage(spk["png_path"], qr_x, qr_y, width=1.0 * cm, height=1.0 * cm)

        # Device ID underneath
        c.setFont("Helvetica-Bold", 6)
        c.setFillColor(colors.HexColor("#0f172a"))
        c.drawCentredString(x + (micro_w / 2.0), y + 0.15 * cm, spk["device_id"])

    c.save()
    print(f"\n[SUCCESS PDF] Generated: {pdf_path}")
    print("   -> Exact 1.0 cm vector dimensions embedded for 100% true-to-scale printing.")
