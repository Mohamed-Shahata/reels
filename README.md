# ReelCast

Upload long podcast and solo talk videos and cut them into short vertical 9:16 reels with Whisper transcription, automated AI topic segmentation, auto-reframing, and burned-in subtitles.

See [docs/PROJECT.md](docs/PROJECT.md) for the target architecture specification and [docs/reels-plan.md](docs/reels-plan.md) for the phased master plan.

## Architecture

- `backend`: NestJS API and background worker pipeline (Prisma, PostgreSQL, RabbitMQ, S3/MinIO storage, FFmpeg)
- `frontend`: Next.js (App Router, Tailwind CSS, i18n support)
- `docs`: Technical documentation and master plan

## Quick Start

```bash
# 1. Install dependencies
npm run install:all

# 2. Setup environment variables
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 3. Start infrastructure (PostgreSQL, Redis/RabbitMQ)
npm run db:up

# 4. Run database migrations
npm --prefix backend run db:migrate

# 5. Start development servers
npm run dev:backend
npm run dev:frontend
```
