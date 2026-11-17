# ==============================================================================
# YHealth Speaker Fleet Management Dashboard - Unified Production Dockerfile
# Multi-stage build: Builds React 18 / Vite frontend, packages FastAPI backend.
# ==============================================================================

# Stage 1: Build Frontend SPA
FROM node:20-alpine AS frontend-builder
WORKDIR /build

# Cache dependency layer
COPY frontend/package*.json ./
RUN npm ci --silent

# Copy frontend source and build static bundle
COPY frontend/ ./
RUN npm run build

# Stage 2: Production Python Runtime
FROM python:3.11-slim AS runner

LABEL maintainer="YHealth Team <engineering@yhealth.me>"
LABEL description="YHealth Healthcare Assistant & Smart Speaker Fleet Management Dashboard"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive \
    DASHBOARD_MODE=demo

WORKDIR /app

# Install system dependencies (iputils-ping for hardware latency ping probes, curl for health checks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    iputils-ping \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python backend dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application source
COPY backend/ ./backend/

# Copy compiled frontend SPA from Stage 1 into backend static directory
COPY --from=frontend-builder /build/dist ./backend/static/

WORKDIR /app/backend

# Expose Dashboard & API port (default: 8010)
EXPOSE 8010

# Healthcheck probe against the Fleet API
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8010/api/speakers || exit 1

# Launch FastAPI ASGI server
CMD ["python", "app.py"]
