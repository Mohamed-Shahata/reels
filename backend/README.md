# ReelCast Backend

NestJS API and background processing worker for the ReelCast platform.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start API server in watch mode |
| `npm run build` | Generate the Prisma client and compile |
| `npm run start:prod` | Run the compiled production build |
| `npm run lint:check` | Run ESLint check |
| `npm run typecheck` | Run TypeScript type check |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run db:migrate` | Create and apply development migrations |
| `npm run db:deploy` | Apply database migrations in production |

## Structure

- `src/config`: Environment schema, defaults, and validation
- `src/common`: Exception filters, interceptors, validation pipes, logging
- `src/prisma`: Prisma client service and module
- `src/health`: Service health check endpoints
- `src/auth`: User registration, authentication, sessions, refresh tokens rotation, guards
- `src/users`: User management and persistence
- `src/videos`: Video uploads, metadata, status tracking, and deletion
- `src/clips`: Clip suggestions, segmentation validation, and clip management
- `src/transcription`: Audio extraction and Whisper transcription
- `src/subtitles`: Subtitle generation, styling presets, and ASS export
- `src/renders`: Reel rendering, FFmpeg pipeline, and export handling
- `src/storage`: Media assets and storage abstraction
- `prisma`: Database schema and migrations
