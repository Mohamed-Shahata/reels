# Backend

NestJS API for the Podcast Reels platform.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start in watch mode |
| `npm run build` | Generate the Prisma client and compile |
| `npm run start:prod` | Run the compiled build |
| `npm run lint:check` | Lint without fixing |
| `npm run typecheck` | Type check |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests |
| `npm run db:migrate` | Create and apply a development migration |
| `npm run db:deploy` | Apply migrations in production |

## Layout

- `src/config`: environment schema and validation
- `src/common`: exception filter, validation pipe, request logging
- `src/prisma`: Prisma service and module
- `src/health`: health check endpoint
- `src/auth`: registration, login, sessions, refresh rotation, logout, global JWT guard, rate limiting
- `src/users`: user persistence
- `src/storage`: Cloudinary wrapper and upload signature
- `prisma`: schema and migrations
