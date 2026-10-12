# YHealth Speaker Fleet Dashboard

React + Vite + Tailwind frontend and a small FastAPI API for the six-speaker fleet.

## What is verified from the existing repository
- The voice backend is FastAPI (`backend/server.py`) and defaults to port `8008`.
- The ESP32 connects over `/ws/live/{doctor_id}`.
- The backend accepts a 12-hex-character `device_id` query parameter and logs the connected device label.
- The existing backend uses Python standard logging.
- The Grafana dashboard URL/UID supplied for this project is `ad7r252`.

## Important integration boundary
The repository inspection did not identify the Grafana data-source type/UID or confirm a device filter variable in the dashboard. This scaffold therefore:
- provides a working fleet UI with explicitly marked demo data;
- links to the existing Grafana dashboard and allows configuring its device variable name;
- includes a FastAPI endpoint contract for logs;
- does not pretend sample logs or statuses are live data.

Before enabling real logs, confirm the existing Grafana data source and how it indexes logs. If it is Loki, configure a server-side Loki/Grafana proxy query. If it is another source, implement the adapter for that source. Do not put Grafana service-account tokens in the browser.

## Run locally

### Backend
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app:app --reload --port 8010
```

### Frontend
In another terminal:
```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```
Open the Vite URL printed in the terminal.

## Configure Grafana
Set `VITE_GRAFANA_BASE_URL` in `frontend/.env` to `https://monitoring.yhealth.me`.
Set `VITE_GRAFANA_DASHBOARD_UID=ad7r252` and optionally `VITE_GRAFANA_DEVICE_VARIABLE=device_id` only if the dashboard has a matching Grafana template variable. The app's link is configurable; this does not create a missing Grafana variable.

## Connect actual data
1. Replace the demo registry in `backend/app.py` with the approved device/assignment source.
2. Implement `GET /api/speakers/{device_id}/logs` for the actual Grafana data source. This currently returns HTTP 501 with a clear message because the datasource has not yet been verified.
3. Add structured device context to every per-connection backend log record, not only the initial WebSocket-connected message. Use a MAC/device ID as a stable field; do not use patient names as log labels.
4. Add authentication and authorization before exposing device assignment or clinical logs.
5. Verify Grafana variable filtering, time ranges, and access permissions using real records.

## Data safety
The six devices and log entries in demo mode are fabricated placeholders. Do not put patient names, clinical notes, phone numbers, bearer tokens, or API keys into the demo registry or frontend environment. Use a server-side authenticated API for real patient/HCP assignments.
