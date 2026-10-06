# ESP32-S3 Gemini Voice Assistant

This project connects a Waveshare ESP32-S3-AUDIO board to a Python FastAPI relay, Gemini Live, and the patient roster/persona APIs. The firmware captures and plays audio; the backend handles Gemini sessions, patient matching, API calls, Redis caching, and WebSocket audio transport.

## Features

- Persistent ESP32-to-backend WebSocket for continuous microphone and speaker audio.
- Gemini Live conversation with audio streaming, voice activity detection, playback buffering, and reconnect handling.
- Patient lookup against API 1's roster, with exact-name matching and last-four phone confirmation only when names are duplicated.
- Persona retrieval from API 2 using the selected roster patient ID and the configured hardware token.
- Redis caching for complete rosters, verified personas and mappings, plus short-lived duplicate-name/session state; process-local RAM cache remains available when Redis is unavailable.
- Outbound HTTP URL, response status, and request duration logging in the backend.
- Spoken service notices for Gemini quota exhaustion and session restarts, using the backend's Edge TTS path.
- Windows PowerShell setup steps, Docker configuration, and detailed architecture/troubleshooting documentation.

## Quick start

### Backend (Windows PowerShell)

```powershell
cd .\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
python server.py
```

Set a valid `GEMINI_API_KEY`, `DEFAULT_DOCTOR_ID`, `PATIENTS_API_DOCTOR_ID`, and current `PERSONA_HARDWARE_TOKEN` in the private `backend/.env`. Configure Redis if using a remote Redis service. The backend listens on port `8008` by default; `http://127.0.0.1:8008/` is its basic health endpoint.

### Firmware

Use an ESP-IDF 5.5 terminal. In the project root, set the ESP32-S3 target, check Wi-Fi and relay settings in `idf.py menuconfig`, then build, flash, and monitor:

```powershell
cd .
idf.py set-target esp32s3
idf.py menuconfig
idf.py -p COM6 flash monitor
```

Configure the backend host and doctor ID in ESP-IDF `menuconfig`; the device connects to `ws://<backend-host>:8008/ws/live/<doctor-id>`. The ESP32 must be able to reach the backend over the network. API 1 and API 2 use the host configured by `PATIENTS_API_BASE_URL` and `PERSONA_API_BASE_URL` in the backend environment.

## Patient lookup behavior

The backend matches a spoken name in API 1's doctor roster. If multiple patients have the same full name, it asks for the last four phone digits and checks them only against those matching roster rows. It then fetches the selected patient's persona from API 2 using that patient's ID. Redis caches the roster, personas, ID mappings, and short-lived conversation state.

If Gemini reports a quota/spend-cap error, the backend uses its separate Edge TTS path to say **“We are updating the system.”** If an already-active Gemini session needs to reconnect, it says **“Restarting system.”** These announcements require the backend WebSocket and Edge TTS service to be reachable.

## Documentation

See [Architecture and Data Flow](./ARCHITECTURE_AND_DATA_FLOW.md) for the detailed system diagram, conversation pipeline, patient matching rules, Redis behavior, environment variables, logs, flashing steps, and troubleshooting guidance.

## Keep credentials and patient data private

Do not commit `backend/.env`, API keys, hardware tokens, Wi-Fi passwords, roster exports, or patient records. The generated `sdkconfig` can contain local Wi-Fi settings and is ignored by Git. Treat backend logs as sensitive because they may include speech transcripts, patient names, and patient IDs.
