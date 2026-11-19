# ReelCast

**ReelCast** is a production-grade platform that transforms long-form podcast and talk videos into polished 9:16 vertical reels with AI-driven speaker tracking, Whisper transcription, automated topic segmentation, dynamic reframing, and burned-in stylized subtitles (with full Arabic RTL & English LTR support).

---

## Architecture Overview

```
                      ┌──────────────────────┐
                      │ Next.js 15 Frontend  │ (Port 3000)
                      └──────────┬───────────┘
                                 │ HTTP / REST
                      ┌──────────▼───────────┐
                      │   NestJS API Server  │ (Port 3001)
                      └────┬───────┬───────┬─┘
       PostgreSQL (5432)   │       │       │   MinIO / S3 (9000)
    ┌──────────────────────┘       │       └──────────────────────┐
    │ Transactional Outbox         │ Presigned Multipart Uploads  │
    ▼                              ▼                              ▼
┌──────────────┐          ┌────────────────┐             ┌─────────────────┐
│  PostgreSQL  │          │ RabbitMQ 3.13  │             │   MinIO / S3    │
│  (Database)  │          │ (Work Queues)  │             │ (Object Storage)│
└──────────────┘          └───────┬────────┘             └────────┬────────┘
                                  │                               │
                      ┌───────────▼──────────┐                    │
                      │  Background Worker   │◄───────────────────┘
                      │ (Job Consumers / DLQ)│
                      └───────────┬──────────┘
                                  │ HTTP Proxy/Turns
                      ┌───────────▼──────────┐
                      │ Python AI Analyzer   │ (Port 8001)
                      │ (Face/Speaker Track) │
                      └──────────────────────┘
```

### Core Components
1. **Frontend (`frontend/`)**: Next.js 15 App Router, Tailwind CSS with semantic CSS custom properties (0 raw hex colors), dual Arabic & English localization, and video pipeline stepper.
2. **API Backend (`backend/`)**: NestJS application handling authentication, presigned S3 multipart uploads, clip management, and job status polling.
3. **Background Worker (`backend/src/worker.ts`)**: Distributed consumer processing pipeline:
   - `INGEST`: ffprobe metadata extraction and fast audio extraction.
   - `TRANSCRIBE`: Whisper speech-to-text with word-level timestamps.
   - `SEGMENT`: AI semantic topic segmentation with boundary snapping.
   - `ANALYZE`: Speaker tracking and face reframe planning.
   - `RENDER`: 60fps / 1080x1920 MP4 rendering with libass subtitle burn-in.
   - `CLEANUP`: Automatic purging of expired renders and soft-deleted assets.
4. **Analyzer (`analyzer/`)**: FastAPI microservice for face tracking and speaker turn analysis.
5. **Storage & Broker**: MinIO S3-compatible storage and RabbitMQ with Dead Letter Exchanges (`reels.dlx`).

---

## Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) >= 22.0.0
- [Docker](https://www.docker.com/) & Docker Compose
- [FFmpeg](https://ffmpeg.org/) (installed locally if running worker outside Docker)

### 2. Installation
Clone the repository and install all dependencies:
```bash
git clone https://github.com/mohamed0shehata/reels.git
cd reels
npm run install:all
```

### 3. Environment Configuration
Copy the environment template files:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

### 4. Start Infrastructure Containers
Start PostgreSQL, RabbitMQ, MinIO, and the Analyzer microservice:
```bash
docker compose up -d
```

Verify service containers are healthy:
```bash
docker compose ps
```

### 5. Run Database Migrations & Generate Prisma Client
```bash
npm --prefix backend run db:migrate
```

### 6. Start Development Servers
Run the three primary components in separate terminal windows:

```bash
# Terminal 1: NestJS API Server
npm run dev:backend

# Terminal 2: Background Worker Consumers
npm run dev:worker

# Terminal 3: Next.js Frontend
npm run dev:frontend
```

---

## Service Endpoints & Consoles

| Service | URL | Default Credentials | Description |
|---|---|---|---|
| **Web UI** | `http://localhost:3000` | N/A | ReelCast Web App |
| **Backend API** | `http://localhost:3001` | N/A | REST API |
| **Health Check** | `http://localhost:3001/health` | N/A | Database, RabbitMQ, S3 status |
| **Admin Queues** | `http://localhost:3001/api/v1/admin/queues` | N/A | Queue metrics & DLQ alert check |
| **RabbitMQ Console** | `http://localhost:15672` | `guest` / `guest` | RabbitMQ Management Dashboard |
| **MinIO Console** | `http://localhost:9001` | `minioadmin` / `minioadmin` | S3 Storage File Browser |
| **Analyzer Health** | `http://localhost:8001/health` | N/A | Python Face & Speaker Tracker |

---

## Quality Assurance & Testing

Run full verification suites across frontend and backend:

```bash
# Run all unit, integration, and E2E test suites
npm test

# Run code style, types, and color-guard checks
npm run check

# Run individual checks
npm --prefix backend run lint:check
npm --prefix backend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run typecheck
node frontend/scripts/check-colors.mjs
```

---

## Operational Runbook

For production operations, monitoring, Dead Letter Queue (DLQ) replay, job troubleshooting, and worker recovery, see **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.
