# System Optimization and Fixes Summary

This document summarizes the system stability patches, network optimizations, and hardware/software configurations applied to the YHealth Healthcare Assistant.

## 1. ESP32 Firmware Stability (`main.c`)
- **Memory Allocation Fixed**: Reduced the `PLAYBACK_RB_SIZE` (Ring Buffer) from 96 KB down to a safe 64 KB, and trimmed the FreeRTOS task stacks. This freed up over 6 KB of critical heap RAM, eliminating silent "Out of Memory" crashes when the microphone DMA initialized.
- **Deadlock Timeout Fixed**: Reduced `GEMINI_RESPONSE_TIMEOUT_MS` from 45 seconds to 12 seconds. If the backend fails to respond, the ESP32 will now automatically break out of the `THINKING` state after 12 seconds instead of hanging permanently.

## 2. Server Backend Robustness (`server.py`)
- **TTS Crash Deadlock Fixed**: Modified the `speak_status_announcement` function to use a strict `finally:` block. Previously, if the local text-to-speech engine (`edge-tts`) crashed due to a VPS network glitch, the server forgot to send the `turn_complete` signal to the ESP32. This was the primary cause of the "stuck in cyan thinking mode" bug. The `turn_complete` signal is now strictly guaranteed.
- **Audio Pacing Fixed**: Corrected an aggressive `mute_until` software gate that was accidentally dropping the doctor's follow-up questions if they spoke too quickly after the assistant finished.
- **Network Jitter Buffers Tuned**: Updated `.env` variables (`PLAYBACK_MAX_LEAD_S=1.0` and `PLAYBACK_TARGET_LEAD_S=0.6`) to force the server to push a larger 600ms audio buffer to the ESP32. This absorbs network latency spikes on the public internet, preventing stuttering audio.

## 3. Server Infrastructure (`nginx_speaker.conf`)
- **Proxy Buffering Disabled**: Reverse proxies like Nginx default to holding incoming TCP packets until a 4KB/8KB buffer is full. This destroyed real-time audio streaming. Configured Nginx with `proxy_buffering off;` and `tcp_nodelay on;` to ensure binary audio chunks are fired to the ESP32 instantly.
- **Keep-Alive Extended**: Set `proxy_read_timeout 3600s;` to prevent Nginx from severing the WebSocket connection during long periods of silence (e.g., when the doctor is pausing or the API is looking up a patient).

## 4. Hardware Limitations & Future Upgrades
- **Power Brownouts**: Running the speaker volume at 70%+ draws high peak current. Standard laptop USB ports cannot supply enough current, causing the ESP32 to reboot (`ClearCommError`). A dedicated 5V 2A wall adapter is required for high-volume playback.
- **Voice Barge-in & AEC**: 
  - **The Hardware**: The board features an ES7210 4-channel ADC with dual digital microphones, which is fully capable of Acoustic Echo Cancellation (AEC).
  - **The Software**: The current `main.c` firmware lacks a DSP pipeline. It uses a "State Mute" approach to avoid feedback loops, which explicitly disables the microphone while the speaker is playing.
  - **The Upgrade Path**: To enable true voice barge-in, the C firmware must be refactored to use the **Espressif Audio Development Framework (ESP-ADF)**. The `ES8311` DAC playback stream must be fed into the `ESP-AEC` software algorithm as a reference signal, which will use the ESP32-S3's DSP to mathematically subtract Lira's voice from the `ES7210` microphone feed in real-time. Until then, the tactile BOOT button must be used to interrupt the assistant.
