# Podcast Reels

Upload a long podcast video and cut it into short reels. See [docs/PROJECT.md](docs/PROJECT.md) for the full product description, architecture, conventions and the phased task list.

## Structure

- `backend`: NestJS API (Prisma, PostgreSQL, Cloudinary)
- `frontend`: Next.js web app
- `docs`: project documentation

## Quick start

```bash
npm run install:all
npm run db:up
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
npm --prefix backend run db:migrate
npm run dev:backend
npm run dev:frontend
```

Fill in the Cloudinary values in `backend/.env` before starting the API.
