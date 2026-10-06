import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    """Canvas that computes total pages dynamically and adds header/footer."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748B"))
        
        # Header (pages > 1)
        if self._pageNumber > 1:
            self.drawString(45, 11 * inch - 30, "ESP32-S3 Voice Assistant — Active vs. Unused Configurations Audit")
            self.setStrokeColor(colors.HexColor("#CBD5E1"))
            self.setLineWidth(0.5)
            self.line(45, 11 * inch - 35, 8.5 * inch - 45, 11 * inch - 35)

        # Footer (all pages)
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(8.5 * inch - 45, 28, page_str)
        self.drawString(45, 28, "Confidential — Waveshare ESP32-S3-AUDIO & Gemini Live System Audit")
        self.setStrokeColor(colors.HexColor("#CBD5E1"))
        self.setLineWidth(0.5)
        self.line(45, 38, 8.5 * inch - 45, 38)
        
        self.restoreState()

def create_audit_pdf(output_path):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=45,
        rightMargin=45,
        topMargin=45,
        bottomMargin=45
    )
    
    # Custom Palette
    PRIMARY = colors.HexColor("#0F172A")    # Deep Navy
    SECONDARY = colors.HexColor("#1E293B")  # Slate Dark
    ACCENT_BLUE = colors.HexColor("#0284C7")# Sky Blue
    ACTIVE_GREEN = colors.HexColor("#059669")# Emerald Green
    UNUSED_AMBER = colors.HexColor("#D97706")# Amber
    BG_LIGHT = colors.HexColor("#F8FAFC")   # Soft light gray
    BG_ALT = colors.HexColor("#F1F5F9")     # Alternate row gray
    BORDER_COLOR = colors.HexColor("#E2E8F0")

    # Typography Styles
    title_style = ParagraphStyle(
        'DocTitle',
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=PRIMARY,
        spaceAfter=3
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#475569"),
        spaceAfter=8
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        fontName='Helvetica-Bold',
        fontSize=11.5,
        leading=15,
        textColor=PRIMARY,
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        fontName='Helvetica',
        fontSize=8.2,
        leading=11,
        textColor=colors.HexColor("#334155")
    )

    tbl_header = ParagraphStyle(
        'TableHeader',
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.white
    )

    tbl_cell = ParagraphStyle(
        'TableCell',
        fontName='Helvetica',
        fontSize=7.5,
        leading=9.8,
        textColor=colors.HexColor("#1E293B")
    )

    tbl_cell_bold = ParagraphStyle(
        'TableCellBold',
        fontName='Helvetica-Bold',
        fontSize=7.5,
        leading=9.8,
        textColor=colors.HexColor("#0F172A")
    )

    tag_used = ParagraphStyle(
        'TagUsed',
        fontName='Helvetica-Bold',
        fontSize=7.2,
        leading=9.2,
        textColor=ACTIVE_GREEN
    )

    tag_unused = ParagraphStyle(
        'TagUnused',
        fontName='Helvetica-Bold',
        fontSize=7.2,
        leading=9.2,
        textColor=UNUSED_AMBER
    )

    story = []

    # Title Banner
    story.append(Paragraph("Waveshare ESP32-S3-AUDIO & Gemini Live Assistant", title_style))
    story.append(Paragraph("System Configuration Contrast: Comprehensive Audit of <b>Active vs. Unused Hardware & Software Features</b>", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT_BLUE, spaceAfter=8))

    # Executive Overview Box
    exec_summary = (
        "<b>Executive Summary:</b> This document provides an exhaustive inventory and contrast of every hardware "
        "peripheral, GPIO routing, firmware module, communication protocol, and backend configuration present on the "
        "<b>Waveshare ESP32-S3-AUDIO Board</b> and its supporting ecosystem. The current implementation operates as a "
        "specialized, low-latency, full-duplex conversational voice assistant integrating Google's <b>Gemini Live Native Audio API</b>. "
        "While core audio, Wi-Fi, DSP, and visual feedback subsystems are operating at peak efficiency, significant onboard hardware "
        "resources (Camera DVP, SPI LCD, SDMMC TF card, PCF85063 RTC, Bluetooth 5.0 LE, and extra GPIO expander lines) remain dormant "
        "and available for future feature expansion."
    )
    
    summary_table = Table(
        [[Paragraph(exec_summary, body_style)]],
        colWidths=[522]
    )
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), BG_LIGHT),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#CBD5E1")),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 6))

    # KPI Summary Cards
    kpi_data = [
        [
            Paragraph("<b>Core Audio Chain</b><br/><font color='#059669'><b>100% Active</b></font><br/>ES7210 4-ch ADC + ES8311 DAC + Class-D PA", tbl_cell),
            Paragraph("<b>Compute & RAM</b><br/><font color='#059669'><b>Active / Optimized</b></font><br/>Dual-Core 240MHz + 512KB SRAM (64KB RingBuf)", tbl_cell),
            Paragraph("<b>Expansion Peripherals</b><br/><font color='#D97706'><b>Available / Dormant</b></font><br/>LCD, DVP Camera, TF Card, RTC, BLE", tbl_cell),
            Paragraph("<b>Cloud & Network</b><br/><font color='#059669'><b>Persistent WebSocket</b></font><br/>16kHz Full-Duplex + 32KB/s Pacer", tbl_cell),
        ]
    ]
    kpi_table = Table(kpi_data, colWidths=[130.5, 130.5, 130.5, 130.5])
    kpi_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor("#ECFDF5")),
        ('BACKGROUND', (1,0), (1,-1), colors.HexColor("#ECFDF5")),
        ('BACKGROUND', (2,0), (2,-1), colors.HexColor("#FFFBEB")),
        ('BACKGROUND', (3,0), (3,-1), colors.HexColor("#ECFDF5")),
        ('BOX', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 8))

    # SECTION 1: Hardware & Peripherals Contrast
    story.append(Paragraph("1. Hardware Peripherals & Board Capabilities Contrast", h1_style))
    
    hw_rows = [
        [
            Paragraph("Hardware Subsystem", tbl_header),
            Paragraph("Component / IC", tbl_header),
            Paragraph("Status", tbl_header),
            Paragraph("Current Operational Implementation", tbl_header),
            Paragraph("Unused Features / Untapped Capabilities", tbl_header)
        ],
        [
            Paragraph("Main Controller", tbl_cell_bold),
            Paragraph("ESP32-S3R8 (Xtensa LX7)", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Dual-core 240MHz. Core 0 handles UI, Wi-Fi & buttons. Core 1 runs dedicated real-time Audio I2S DSP & Playback.", tbl_cell),
            Paragraph("Deep sleep / Light sleep low-power states, hardware ULP coprocessor execution.", tbl_cell)
        ],
        [
            Paragraph("Memory Architecture", tbl_cell_bold),
            Paragraph("512KB SRAM + 8MB PSRAM", tbl_cell),
            Paragraph("● PARTIAL", tag_used),
            Paragraph("512KB internal high-speed SRAM actively utilized for 64KB audio ringbuffer, task stacks, and DMA buffers.", tbl_cell),
            Paragraph("8MB stacked Octal PSRAM available for large image framebuffers, audio caching, or local neural models.", tbl_cell)
        ],
        [
            Paragraph("Audio Input / ADC", tbl_cell_bold),
            Paragraph("ES7210 4-Ch ADC + Dual Digital Mics", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("ES7210 sampled @ 16kHz via I2S0 with hardware gain (24.0dB) and real-time 32-bit to 16-bit mono downmix.", tbl_cell),
            Paragraph("Ch 3 & 4 line-in inputs, hardware voice activity interrupt trigger, onboard hardware beamforming DSP.", tbl_cell)
        ],
        [
            Paragraph("Audio Output / DAC", tbl_cell_bold),
            Paragraph("Everest ES8311 + Class-D PA", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("16kHz 16-bit mono playback via I2S1. Dynamic software gain (0-100%). Class-D amplifier powered via TCA9555.", tbl_cell),
            Paragraph("Hardware ALC (Auto Level Control), headphone output detection, high sample rates (44.1k/48k/96k).", tbl_cell)
        ],
        [
            Paragraph("GPIO Expansion", tbl_cell_bold),
            Paragraph("TCA9555PWR (I2C 0x20)", tbl_cell),
            Paragraph("● PARTIAL", tag_used),
            Paragraph("P1_0 configured as PA Power Enable. P1_1 (Vol+), P1_2 (Vol-), and P1_3 (Start/Stop) polled as user buttons.", tbl_cell),
            Paragraph("Port 0 (P0_0–P0_7: 8 pins) and Port 1 upper pins (P1_4–P1_7: 4 pins) are inactive/unmapped.", tbl_cell)
        ],
        [
            Paragraph("Visual Feedback", tbl_cell_bold),
            Paragraph("7x WS2812 RGB LED Ring", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("GPIO 38 driving pastel conversational animations (Ice Blue, Mint, Warm Peach, Lavender) & 7-LED VU volume meter.", tbl_cell),
            Paragraph("Complex chasing effects, multi-color gradient alarms, ambient light sync.", tbl_cell)
        ],
        [
            Paragraph("Physical Controls", tbl_cell_bold),
            Paragraph("BOOT (GPIO 0) + 3x TCA9555", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("BOOT button triggers manual standby/active toggle. TCA9555 buttons adjust volume and toggle modes.", tbl_cell),
            Paragraph("Long-press detection, double-click gestures, factory reset button sequence.", tbl_cell)
        ],
        [
            Paragraph("Wireless Connectivity", tbl_cell_bold),
            Paragraph("Wi-Fi 802.11 b/g/n + Bluetooth 5.0 LE", tbl_cell),
            Paragraph("● PARTIAL", tag_used),
            Paragraph("2.4 GHz Wi-Fi STA mode actively maintained with persistent WebSocket TCP connection.", tbl_cell),
            Paragraph("Bluetooth 5.0 LE completely UNUSED (no BLE advertising, GATT service, or BLE Wi-Fi provisioning).", tbl_cell)
        ],
        [
            Paragraph("Mass Storage", tbl_cell_bold),
            Paragraph("TF / MicroSD Card Slot", tbl_cell),
            Paragraph("○ UNUSED", tag_unused),
            Paragraph("None (Inactive).", tbl_cell),
            Paragraph("SDMMC / SPI mode (GPIO 40, 41, 42). Untapped for offline conversation logs, MP3 playback, or local models.", tbl_cell)
        ],
        [
            Paragraph("Display Expansion", tbl_cell_bold),
            Paragraph("18-Pin SPI LCD Interface", tbl_cell),
            Paragraph("○ UNUSED", tag_unused),
            Paragraph("None (Headless voice operation).", tbl_cell),
            Paragraph("SPI display header with backlight and touch support. Available for LVGL GUI, waveform visualizer, or status screen.", tbl_cell)
        ],
        [
            Paragraph("Vision Expansion", tbl_cell_bold),
            Paragraph("24-Pin DVP Camera Interface", tbl_cell),
            Paragraph("○ UNUSED", tag_unused),
            Paragraph("None (Inactive).", tbl_cell),
            Paragraph("OV2640 / OV5640 24-pin parallel DVP camera interface. Available for multimodal vision-language AI.", tbl_cell)
        ],
        [
            Paragraph("Real-Time Clock", tbl_cell_bold),
            Paragraph("PCF85063 (I2C)", tbl_cell),
            Paragraph("○ UNUSED", tag_unused),
            Paragraph("None (Timekeeping handled via esp_timer & network SNTP).", tbl_cell),
            Paragraph("Independent hardware coin-cell battery-backed clock, hardware alarm interrupts, ultra-low power wake-up.", tbl_cell)
        ],
        [
            Paragraph("Power Management", tbl_cell_bold),
            Paragraph("3.7V Li-Po JST + MP1605GTF", tbl_cell),
            Paragraph("● PASSIVE", tag_used),
            Paragraph("USB Type-C power input active; onboard regulator delivers clean 3.3V/2A rail to audio codecs.", tbl_cell),
            Paragraph("Battery state-of-charge ADC sensing, solar charging telemetry, low-battery warning interrupts.", tbl_cell)
        ]
    ]

    hw_table = Table(hw_rows, colWidths=[90, 100, 52, 140, 140])
    hw_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('BOX', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, BG_ALT]),
    ]))
    story.append(hw_table)
    story.append(Spacer(1, 10))

    # SECTION 2: GPIO & Pin Interface Matrix
    story.append(Paragraph("2. GPIO Pinout & Physical Interface Mapping", h1_style))
    
    gpio_rows = [
        [
            Paragraph("ESP32 Pin", tbl_header),
            Paragraph("Designated Function", tbl_header),
            Paragraph("Hardware Interconnect", tbl_header),
            Paragraph("Operational State", tbl_header),
            Paragraph("Notes / Configuration", tbl_header)
        ],
        [Paragraph("GPIO 0", tbl_cell_bold), Paragraph("BOOT Button", tbl_cell), Paragraph("Onboard Tactile Switch", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Configured as Pull-Up GPIO Input for manual Start/Stop toggle.", tbl_cell)],
        [Paragraph("GPIO 10", tbl_cell_bold), Paragraph("I2C SCL", tbl_cell), Paragraph("Master I2C Bus", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("100 kHz clock line connected to ES7210, ES8311, TCA9555, PCF85063.", tbl_cell)],
        [Paragraph("GPIO 11", tbl_cell_bold), Paragraph("I2C SDA", tbl_cell), Paragraph("Master I2C Bus", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Data line for peripheral codec register configuration.", tbl_cell)],
        [Paragraph("GPIO 12", tbl_cell_bold), Paragraph("I2S MCLK", tbl_cell), Paragraph("Master Audio Clock", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Provides master synchronization clock to ES7210 ADC.", tbl_cell)],
        [Paragraph("GPIO 13", tbl_cell_bold), Paragraph("I2S BCLK / SCLK", tbl_cell), Paragraph("Bit Clock", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Continuous bit clock for 16kHz stereo/mono digital audio streams.", tbl_cell)],
        [Paragraph("GPIO 14", tbl_cell_bold), Paragraph("I2S LRCK / WS", tbl_cell), Paragraph("Word Select / Frame Sync", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Left/Right channel framing clock (16 kHz).", tbl_cell)],
        [Paragraph("GPIO 15", tbl_cell_bold), Paragraph("I2S SDIN", tbl_cell), Paragraph("ES7210 ADC Data Out", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Carries 4-ch 32-bit raw PCM stream from digital microphone array.", tbl_cell)],
        [Paragraph("GPIO 16", tbl_cell_bold), Paragraph("I2S SDOUT", tbl_cell), Paragraph("ES8311 DAC Data In", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Feeds 16-bit mono synthesized audio stream to speaker amplifier.", tbl_cell)],
        [Paragraph("GPIO 19 / 20", tbl_cell_bold), Paragraph("USB D- / D+", tbl_cell), Paragraph("USB Type-C Connector", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Serial flashing, JTAG debugging, and real-time runtime ESP_LOG monitoring.", tbl_cell)],
        [Paragraph("GPIO 38", tbl_cell_bold), Paragraph("WS2812 Data", tbl_cell), Paragraph("7x RGB LED Ring", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Dedicated RMT peripheral driving pastel state & VU volume animations.", tbl_cell)],
        [Paragraph("GPIO 40", tbl_cell_bold), Paragraph("TF Card CLK", tbl_cell), Paragraph("MicroSD Slot", tbl_cell), Paragraph("○ INACTIVE", tag_unused), Paragraph("SPI / SDMMC Clock pin; unused in current headless cloud firmware.", tbl_cell)],
        [Paragraph("GPIO 41", tbl_cell_bold), Paragraph("TF Card D0", tbl_cell), Paragraph("MicroSD Slot", tbl_cell), Paragraph("○ INACTIVE", tag_unused), Paragraph("SPI MISO / SDMMC Data 0; unused.", tbl_cell)],
        [Paragraph("GPIO 42", tbl_cell_bold), Paragraph("TF Card CMD", tbl_cell), Paragraph("MicroSD Slot", tbl_cell), Paragraph("○ INACTIVE", tag_unused), Paragraph("SPI MOSI / SDMMC Command; unused.", tbl_cell)],
        [Paragraph("TCA9555 P1_0", tbl_cell_bold), Paragraph("PA_EN", tbl_cell), Paragraph("Class-D Power Amplifier", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Output HIGH driven over I2C to energize onboard speaker amplifier.", tbl_cell)],
        [Paragraph("TCA9555 P1_1..3", tbl_cell_bold), Paragraph("Buttons SW1..3", tbl_cell), Paragraph("Onboard Tactile Buttons", tbl_cell), Paragraph("● ACTIVE", tag_used), Paragraph("Hardware Volume UP, Volume DOWN, and Mode Toggle inputs.", tbl_cell)],
        [Paragraph("TCA9555 P0_0..7", tbl_cell_bold), Paragraph("Port 0 Expansion", tbl_cell), Paragraph("General Header / Unmapped", tbl_cell), Paragraph("○ INACTIVE", tag_unused), Paragraph("8 general-purpose I/O pins configured as passive inputs.", tbl_cell)],
    ]

    gpio_table = Table(gpio_rows, colWidths=[75, 95, 110, 52, 190])
    gpio_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), SECONDARY),
        ('BOX', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 2.8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2.8),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, BG_ALT]),
    ]))
    story.append(gpio_table)
    story.append(Spacer(1, 10))

    # SECTION 3: Firmware, DSP & Software Configurations
    story.append(Paragraph("3. Firmware, FreeRTOS & Communication Stack Contrast", h1_style))
    
    sw_rows = [
        [
            Paragraph("Software Layer", tbl_header),
            Paragraph("Component / Config", tbl_header),
            Paragraph("Status", tbl_header),
            Paragraph("Current Implementation Detail", tbl_header),
            Paragraph("Unused / Alternative Options", tbl_header)
        ],
        [
            Paragraph("RTOS Multithreading", tbl_cell_bold),
            Paragraph("FreeRTOS SMP Dual-Core", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Task pinning: Core 0 (Buttons Pri 4, LED Pri 3, Wi-Fi). Core 1 (Audio Playback Pri 10, Continuous Mic Pri 9).", tbl_cell),
            Paragraph("Single-core execution mode, FreeRTOS co-routines.", tbl_cell)
        ],
        [
            Paragraph("Audio Ingestion", tbl_cell_bold),
            Paragraph("Software Energy RMS VAD", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Real-time PCM RMS calculation (Wake thresh 65.0 RMS, Active thresh 45.0 RMS, 380ms silence cut-off).", tbl_cell),
            Paragraph("ESP-SR WakeNet offline neural wake word models, ESP-SR MultiNet local speech command recognition.", tbl_cell)
        ],
        [
            Paragraph("Feedback Suppression", tbl_cell_bold),
            Paragraph("State Mute & 500ms Cooldown", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Microphone stream is suppressed during audio playback and for a 500ms post-utterance cooldown.", tbl_cell),
            Paragraph("Hardware Acoustic Echo Cancellation (ESP-AEC algorithm), active DSP beamforming subtraction.", tbl_cell)
        ],
        [
            Paragraph("Jitter & Buffering", tbl_cell_bold),
            Paragraph("64KB Playback RingBuffer", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Byte-level FreeRTOS ringbuffer with ~200ms pre-buffering barrier to prevent Wi-Fi underrun crackle.", tbl_cell),
            Paragraph("PSRAM-backed multi-megabyte ringbuffer, dynamic adaptive jitter buffer.", tbl_cell)
        ],
        [
            Paragraph("Network Protocol", tbl_cell_bold),
            Paragraph("Persistent WebSocket Client", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Persistent full-duplex WebSocket (`ws://IP:8008/ws/live`) with binary PCM streaming and JSON turn-markers.", tbl_cell),
            Paragraph("HTTP POST chunked streaming, MQTT broker publishing, gRPC client directly on microcontroller.", tbl_cell)
        ],
        [
            Paragraph("Audio Framework", tbl_cell_bold),
            Paragraph("esp_codec_dev HAL", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Standard Espressif Codec Device HAL controlling ES7210 and ES8311 over unified I2C/I2S handles.", tbl_cell),
            Paragraph("ESP-ADF (Audio Development Framework) full pipeline element architecture.", tbl_cell)
        ],
        [
            Paragraph("Firmware Maintenance", tbl_cell_bold),
            Paragraph("Direct Serial Flashing", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Flashing via USB Type-C using `idf.py -p COM6 flash monitor`.", tbl_cell),
            Paragraph("Over-The-Air (OTA) firmware upgrade via Wi-Fi, dual-bank bootloader partition switching.", tbl_cell)
        ]
    ]

    sw_table = Table(sw_rows, colWidths=[85, 95, 52, 145, 145])
    sw_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('BOX', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, BG_ALT]),
    ]))
    story.append(sw_table)
    story.append(Spacer(1, 10))

    # SECTION 4: Backend & Cloud AI Configurations
    story.append(Paragraph("4. Backend Relay Engine & Cloud AI Contrast", h1_style))
    
    be_rows = [
        [
            Paragraph("Subsystem", tbl_header),
            Paragraph("Configuration / Engine", tbl_header),
            Paragraph("Status", tbl_header),
            Paragraph("Current Operational Implementation", tbl_header),
            Paragraph("Unused / Deprecated Configurations", tbl_header)
        ],
        [
            Paragraph("AI Reasoning Engine", tbl_cell_bold),
            Paragraph("Google Gemini Live API", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Direct native bi-directional audio reasoning over persistent session with system persona injection.", tbl_cell),
            Paragraph("Traditional 3-tier cascade (Whisper STT -> GPT-4/Claude Text LLM -> ElevenLabs TTS).", tbl_cell)
        ],
        [
            Paragraph("Sample Rate Adapter", tbl_cell_bold),
            Paragraph("Polyphase Cubic Hermite DSP", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Downsamples Gemini 24kHz audio to 16kHz on-the-fly with zero phase distortion.", tbl_cell),
            Paragraph("Static offline FFmpeg file conversion, nearest-neighbor sample dropping.", tbl_cell)
        ],
        [
            Paragraph("Transmission Pacing", tbl_cell_bold),
            Paragraph("32 KB/s Flow Pacer", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Backend paces audio chunks at exact hardware playback speed to eliminate buffer overflow.", tbl_cell),
            Paragraph("Unpaced burst transmission (causes client buffer overflow and dropped audio chunks).", tbl_cell)
        ],
        [
            Paragraph("Knowledge Context", tbl_cell_bold),
            Paragraph("patient_persona.json (Clinical)", tbl_cell),
            Paragraph("● ACTIVE", tag_used),
            Paragraph("Custom clinical profile of patient 'Samarth' injected at session handshake for medical voice Q&A.", tbl_cell),
            Paragraph("External Vector Database (RAG), dynamic SQL database connector, EHR FHIR API integration.", tbl_cell)
        ],
        [
            Paragraph("Legacy Fallbacks", tbl_cell_bold),
            Paragraph("TTS Synthesis & Whisper STT", tbl_cell),
            Paragraph("○ UNUSED", tag_unused),
            Paragraph("None (Gemini Live handles native audio end-to-end).", tbl_cell),
            Paragraph("Edge-TTS, ElevenLabs REST endpoints, local Whisper STT scripts present in backend codebase.", tbl_cell)
        ]
    ]

    be_table = Table(be_rows, colWidths=[85, 95, 52, 145, 145])
    be_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), SECONDARY),
        ('BOX', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, BG_ALT]),
    ]))
    story.append(be_table)
    story.append(Spacer(1, 10))

    # SECTION 5: Architectural Recommendations
    story.append(Paragraph("5. Architectural Recommendations & Future Utilization of Dormant Hardware", h1_style))
    
    rec_text = (
        "<b>1. Multimodal Vision-Language Upgrade (24-Pin DVP Camera):</b> Connecting an OV2640/OV5640 camera to the dormant "
        "DVP interface allows the assistant to capture live images on user request ('Look at this medicine prescription') and stream "
        "JPEG frames alongside PCM audio directly to Google Gemini's multimodal vision endpoint.<br/>"
        "<b>2. Local Audio Logging & Offline Mode (TF / MicroSD Slot):</b> Initializing SDMMC over GPIOs 40/41/42 allows storing "
        "offline medical alerts, local sound prompts (chimes, error tones), and continuous conversation transcripts without relying on Wi-Fi.<br/>"
        "<b>3. Rich HMI Dashboard (18-Pin SPI LCD Interface):</b> Driving a 1.85\" to 2.4\" LCD using LVGL enables live clinical metrics "
        "display (heart rate, blood pressure, weight charts) to complement spoken voice responses.<br/>"
        "<b>4. Ultra-Low Power Standby & Real-World Scheduling (PCF85063 RTC + BLE):</b> Leveraging the I2C RTC and BLE provisioning "
        "enables consumer-grade onboarding via a mobile app and programmed medication alarm wake-ups from deep sleep."
    )
    
    rec_table = Table(
        [[Paragraph(rec_text, body_style)]],
        colWidths=[522]
    )
    rec_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), BG_LIGHT),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#CBD5E1")),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(rec_table)

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated PDF report: {output_path}")

if __name__ == "__main__":
    out_file = sys.argv[1] if len(sys.argv) > 1 else "ESP32_S3_Audio_Configurations_Contrast_Report.pdf"
    create_audit_pdf(out_file)
