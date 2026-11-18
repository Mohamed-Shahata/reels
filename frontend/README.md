# ReelCast Frontend

Next.js web application for the ReelCast platform.

## Scripts

| Script                 | Description                         |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Start development server on port 3000 |
| `npm run build`        | Build production bundle             |
| `npm run lint`         | Run ESLint checks                   |
| `npm test`             | Run frontend unit tests             |
| `npm run typecheck`    | Generate route types and run typecheck |
| `npm run format:check` | Check code formatting               |

## Setup

Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL` if running against a custom API endpoint:

```bash
cp .env.example .env.local
```
