# KVM2 Production Deployment Guide — YHealth Smart Speaker Backend

This repository contains the complete production backend stack for the YHealth Smart Voice Assistant & Fleet Management System.

---

## 1. Architecture Overview

```
                      [ Internet / Any Wi-Fi Network ]
                                     │
                                     ▼
                      [ KVM2 Public IP / Domain ]
                     (e.g., speaker.yhealth.me)
                                     │
                         [ Nginx (Port 80 / 443 SSL) ]
                                     │
            ┌────────────────────────┴────────────────────────┐
            ▼                                                 ▼
   /ws/live and /api/                  /fleet /api/speakers
   Voice Assistant Backend              Fleet Management Dashboard
   (Docker Container: 8008)             (Docker Container: 8010)
            │                                                 │
            ├─────────────── Gemini 3.1 Live API ─────────────┤
            ├─────────────── Patient Persona API 2 ───────────┤
            └─────────────── Doctor Roster API 1 ─────────────┘
```

---

## 2. Prerequisites on KVM2

- **OS**: Ubuntu 22.04 LTS / Debian 12 / Rocky Linux 9
- **Docker**: Docker Engine 24.0+ and Docker Compose v2.20+
- **Nginx**: System Nginx or Dockerized Nginx with Certbot (SSL)
- **Open Inbound Ports**:
  - `80` (HTTP for Let's Encrypt challenge)
  - `443` (HTTPS / Secure WebSockets `wss://`)
  - Optional Direct: `8008` (Voice WS) and `8010` (Dashboard) if testing without reverse proxy.

---

## 3. Quick Start Deployment (Docker Compose)

### Step 1: Clone Repository
```bash
git clone https://github.com/TFTPL/yhealth-smart-speaker-backend.git
cd yhealth-smart-speaker-backend
```

### Step 2: Configure Environment Variables
Create `backend/.env` from `backend/.env.example`:
```bash
cp backend/.env.example backend/.env
nano backend/.env
```
Ensure the following production credentials are set:
```ini
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.8-flash-tts
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_VOICE=Kore
PORT=8008

PATIENTS_API_BASE_URL=https://ychat-be.yhealth.me/agent/patients
DEFAULT_DOCTOR_ID=6789ebb61a093d60fa691c39
PATIENTS_API_DOCTOR_ID=6789ebb61a093d60fa691c39
DEFAULT_DOCTOR_NAME=Brij Mohan Makkar
DEFAULT_DOCTOR_SPECIALIZATION=Diabetes & Obesity specialist
DEFAULT_DOCTOR_CLINIC=Dr. Makkar's Diabetes and Obesity Centre, Paschim Vihar, New Delhi

PERSONA_API_BASE_URL=https://ychat-be.yhealth.me/persona-hardware
DOCTOR_PERSONA_API_BASE_URL=https://ychat-be.yhealth.me/agent/doctor-chat
PERSONA_HARDWARE_TOKEN=7c875373n3c8502c75921593nc49nccn753

REDIS_URL=rediss://default:gQAAAAAABNupAAIgcDFlYWQzYTQ0NGMyOTM0YmE5YmVhZDE3YmFlMWYyZGJkNQ@touching-turkey-318377.upstash.io:6379
REDIS_TLS=true
```

### Step 3: Build and Start Containers
```bash
docker compose up -d --build
```

### Step 4: Verify Containers
```bash
docker compose ps
curl http://localhost:8008/api/active-speakers
curl http://localhost:8010/api/speakers
```

---

## 4. Production Nginx Reverse Proxy Configuration (SSL / WSS)

Create `/etc/nginx/sites-available/yhealth-speaker.conf`:

```nginx
server {
    listen 80;
    server_name speaker.yhealth.me;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name speaker.yhealth.me;

    ssl_certificate /etc/letsencrypt/live/speaker.yhealth.me/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/speaker.yhealth.me/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 1. Voice Assistant Backend WebSocket & REST (Port 8008)
    location /ws/ {
        proxy_pass http://127.0.0.1:8008;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location /api/active-speakers {
        proxy_pass http://127.0.0.1:8008;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 2. Fleet Dashboard Backend & Frontend (Port 8010)
    location / {
        proxy_pass http://127.0.0.1:8010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site and reload Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/yhealth-speaker.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. Firmware Connection Note

Once deployed on KVM2:
- The ESP32 speakers connect to:
  `wss://speaker.yhealth.me/ws/live/6789ebb61a093d60fa691c39`
- Any speaker flashed with this URL will connect automatically from **any Wi-Fi network globally** (home, clinic, hospital, mobile hotspot) without requiring a local development computer.
