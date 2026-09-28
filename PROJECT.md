# Podcast-to-Reels Platform

A web platform where a user uploads a long podcast video and cuts it into short vertical reels. The first release is fully manual. AI, reframing and subtitles are added in later phases, one feature at a time.

---

## 1. Product Overview

### 1.1 Goal

Turn one long podcast video (about 1 hour) into a set of short clips ready for social media.

### 1.2 Final vision

1. The user registers and logs in.
2. The user uploads a podcast video.
3. The system extracts a transcript from the video.
4. An AI model analyses the transcript and splits the whole video, in order, into topic-based segments (a topic, a tip, a piece of information). Segments are contiguous and never skip parts of the video.
5. The user reviews the segments and can adjust the start and end time of any clip manually.
6. Each clip is exported in 9:16 format, with optional subtitles.
7. Access is sold through subscription plans.

### 1.3 Delivery strategy

The system is built feature by feature. Each phase must be complete, tested and stable before the next phase starts.

| Phase | Scope |
|-------|-------|
| 0 | Project foundation |
| 1 | Authentication |
| 2 | Video upload with resume and retry |
| 3 | Manual clipping |
| 4 | MVP hardening |
| 5 | Transcription |
| 6 | AI topic segmentation |
| 7 | 9:16 reframing |
| 8 | Subtitles |
| 9 | Subscriptions and production readiness |

The first usable release (MVP) is the end of Phase 4: a user can register, upload a podcast and cut reels manually.

---

## 2. Scope

### 2.1 In scope for the MVP (Phases 0 to 4)

- Email and password registration and login
- Uploading a large video directly to Cloudinary, with progress, resume and retry
- Video library per user
- Manual clip creation by start and end time with preview
- Clip list, rename, edit, delete and download
- Basic usage tracking and cleanup

### 2.2 Out of scope for the MVP

- Transcription and any AI feature
- Reframing to 9:16
- Subtitles
- Payments and subscription plans
- Publishing to social platforms

---

## 3. Architecture

### 3.1 Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS |
| Backend | NestJS, TypeScript |
| Database | PostgreSQL with Prisma |
| Media storage and delivery | Cloudinary |
| Queue (from Phase 5) | BullMQ with Redis |
| Transcription (Phase 5) | Groq Whisper |
| Topic analysis (Phase 6) | Groq LLM |
| Video processing (Phases 7 and 8) | FFmpeg in a worker, or Cloudinary transformations |

The frontend is a pure client of the backend REST API. Next.js is not used for long-running work.

### 3.2 High-level flow (MVP)

```
Browser ──(1) request upload signature──▶ NestJS API
Browser ◀─(2) signed params─────────────  NestJS API
Browser ──(3) chunked upload────────────▶ Cloudinary
Browser ──(4) confirm upload (public id)▶ NestJS API ──▶ PostgreSQL
Browser ──(5) create clip (start, end)──▶ NestJS API ──▶ PostgreSQL
Browser ◀─(6) clip playback/download URL─ Cloudinary (URL transformation)
```

### 3.3 Design decisions

- **Direct upload.** The browser uploads straight to Cloudinary using a signature issued by the backend. Large files never pass through the API server.
- **Chunked upload.** One-hour videos are large, so uploads are chunked to allow progress reporting and retry of failed chunks only.
- **Clips are records, not files (MVP).** A clip is stored as `startSec` and `endSec` on a video. The playable and downloadable clip is produced by a Cloudinary URL transformation using start and end offsets. No server-side video processing is required in the MVP.
- **Validate the Cloudinary approach early.** Task 3.1 is a spike to confirm offset-based trimming and attachment download work on the chosen Cloudinary plan and file sizes. If limits block it, the fallback is FFmpeg in a worker.
- **Backend is separate from Next.js.** This keeps the system ready for background jobs, queues and heavier processing in later phases.

---

## 4. Data Model (MVP)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  videos       Video[]
  sessions     Session[]
}

model Session {
  id               String   @id @default(cuid())
  userId           String
  refreshTokenHash String
  expiresAt        DateTime
  createdAt        DateTime @default(now())

  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

enum VideoStatus {
  UPLOADING
  READY
  FAILED
}

model Video {
  id               String      @id @default(cuid())
  userId           String
  title            String
  cloudinaryId     String?     @unique
  durationSec      Float?
  sizeBytes        BigInt?
  status           VideoStatus @default(UPLOADING)
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  user             User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  clips            Clip[]

  @@index([userId])
}

model Clip {
  id        String   @id @default(cuid())
  videoId   String
  title     String
  startSec  Float
  endSec    Float
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  video     Video    @relation(fields: [videoId], references: [id], onDelete: Cascade)

  @@index([videoId])
}
```

Later phases add: `Transcript`, `TranscriptSegment`, `ProcessingJob`, `Plan`, `Subscription`, `UsageRecord`. Clips will gain a `source` field (`MANUAL` or `AI`) and render options (`reframe`, `subtitles`).

---

## 5. API Overview (MVP)

All routes are prefixed with `/api/v1`. All request bodies are validated. All errors use one consistent JSON shape.

### Auth

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/auth/register` | Create an account |
| POST | `/auth/login` | Log in and receive tokens |
| POST | `/auth/refresh` | Rotate the refresh token |
| POST | `/auth/logout` | Revoke the current session |
| GET | `/auth/me` | Get the current user |

### Videos

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/videos` | Create a video record and return upload signature |
| POST | `/videos/:id/complete` | Confirm upload and store Cloudinary metadata |
| GET | `/videos` | List the current user's videos |
| GET | `/videos/:id` | Get one video with its clips |
| PATCH | `/videos/:id` | Rename a video |
| DELETE | `/videos/:id` | Delete a video and its Cloudinary asset |

### Clips

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/videos/:id/clips` | Create a clip |
| GET | `/videos/:id/clips` | List clips of a video |
| PATCH | `/clips/:id` | Update title, start or end |
| DELETE | `/clips/:id` | Delete a clip |
| GET | `/clips/:id/download` | Get a download URL |

### Clip validation rules

- `startSec >= 0`
- `endSec > startSec`
- `endSec <= video.durationSec`
- Minimum clip length and maximum clip length are configurable (defaults: 5 seconds and 180 seconds)
- Clips of one video may overlap in the MVP, since they are created manually

---

## 6. Frontend Pages (MVP)

| Route | Purpose |
|-------|---------|
| `/register` | Sign-up form |
| `/login` | Login form |
| `/videos` | Video library with status and upload button |
| `/videos/new` | Upload screen with progress, pause, resume and retry |
| `/videos/[id]` | Video player, timeline, clip creation form, clip list |

The clipping screen must support: entering start and end time as `mm:ss`, setting start or end from the current playhead position, previewing the range before saving, and editing or deleting existing clips.

---

## 7. Engineering Conventions

### 7.1 Language

- **Everything in the system is English.** This includes source code, identifiers, UI text, validation and error messages, logs, database seed data, commit messages and documentation.
- No Arabic text anywhere in the repository or the product.

### 7.2 Comments

- **No comments in code by default.** Code must be readable through good naming and small functions.
- A comment is allowed only when the logic is genuinely complex or non-obvious, and it must explain why, not what.
- Every comment is written in English.
- Commented-out code is never committed.

### 7.3 Code style

- TypeScript strict mode on both apps. No `any` without a strong reason.
- DTO validation with `class-validator` in NestJS, shared schemas with `zod` on the frontend.
- One module per domain in NestJS (`auth`, `users`, `videos`, `clips`, `storage`).
- Business logic lives in services, controllers stay thin.
- Environment variables are validated at startup. Secrets are never committed.
- ESLint and Prettier are mandatory and enforced in CI.

### 7.4 Git

- Branch per task: `feat/<task-id>-short-name`.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.
- Small pull requests. One task per pull request when possible.

### 7.5 Definition of done

A task is done only when:

- Acceptance criteria are met
- Input validation and error handling are in place
- Tests are written for the business logic
- Lint and type checks pass
- Documentation is updated if behaviour or setup changed

---

## 8. Task Breakdown

Each task has an ID, a description and acceptance criteria. Tasks inside a phase are ordered. Do not start a phase before the previous one is complete.

### Phase 0: Foundation

**0.1 Repository setup**
Create a monorepo (or two repositories) with `apps/api` (NestJS) and `apps/web` (Next.js).
Acceptance: both apps start locally with one command each.

**0.2 Tooling**
Configure TypeScript strict mode, ESLint, Prettier, Husky pre-commit hook, and a CI pipeline that runs lint, type check and tests.
Acceptance: CI fails on any lint or type error.

**0.3 Database**
Set up PostgreSQL (local Docker Compose) and Prisma. Create the initial migration for the MVP schema.
Acceptance: `prisma migrate dev` creates all tables from a clean database.

**0.4 Configuration**
Add validated environment configuration for both apps, and a `.env.example` file.
Acceptance: the API refuses to start with missing or invalid variables.

**0.5 API foundations**
Global validation pipe, global exception filter with a consistent error shape, request logging, health check endpoint, CORS configuration, API versioning prefix.
Acceptance: `GET /api/v1/health` returns OK, invalid input returns a structured 400.

**0.6 Cloudinary setup**
Create the Cloudinary account, configure credentials and an upload preset for videos, and create a `storage` module in the API wrapping the SDK.
Acceptance: the API can generate an upload signature.

### Phase 1: Authentication

**1.1 Registration**
Endpoint with email validation, password rules and argon2 hashing. Reject duplicate emails.
Acceptance: user is created, password is never returned or logged.

**1.2 Login and tokens**
Short-lived access token and rotating refresh token stored hashed in `Session`. Tokens delivered in httpOnly secure cookies.
Acceptance: login returns valid session, wrong credentials return a generic error.

**1.3 Refresh, logout and me**
Refresh rotation with reuse detection, logout revokes the session, `me` returns the current user.
Acceptance: a reused refresh token invalidates the session.

**1.4 Auth guard and rate limiting**
Global JWT guard with a public decorator, and rate limiting on auth routes.
Acceptance: protected routes return 401 without a valid session.

**1.5 Frontend auth**
Register and login pages, session handling, route protection, logout action.
Acceptance: unauthenticated users are redirected to `/login`, authenticated users cannot see auth pages.

**1.6 Auth tests**
Unit tests for services and end-to-end tests for the full auth flow.
Acceptance: all auth flows covered, tests green in CI.

### Phase 2: Video Upload

**2.1 Create video and signature endpoint**
`POST /videos` creates a video record with status `UPLOADING` and returns a signed upload payload scoped to that user and video.
Acceptance: signature cannot be reused for another user's video.

**2.2 Chunked upload client**
Upload directly to Cloudinary in chunks with progress reporting.
Acceptance: a one-hour video uploads with a live progress bar.

**2.3 Retry and resume**
Failed chunks retry automatically with backoff. If the tab closes or the network drops, the upload can resume instead of restarting.
Acceptance: disconnecting the network mid-upload and reconnecting continues from the last completed chunk.

**2.4 Complete upload**
`POST /videos/:id/complete` verifies the asset with Cloudinary, stores public id, duration and size, and sets status `READY`. Failed uploads are marked `FAILED`.
Acceptance: only videos that truly exist in Cloudinary become `READY`.

**2.5 Upload limits and validation**
Allowed formats, maximum file size and maximum duration configurable through environment variables.
Acceptance: invalid files are rejected before upload starts.

**2.6 Video library**
List, rename and delete videos. Delete also removes the Cloudinary asset.
Acceptance: deleting a video removes its clips and its stored asset.

**2.7 Stale upload cleanup**
Scheduled job that marks abandoned `UPLOADING` videos as `FAILED` and removes partial assets.
Acceptance: uploads older than the configured threshold are cleaned automatically.

### Phase 3: Manual Clipping

**3.1 Cloudinary trimming spike**
Verify that clips can be produced by offset-based URL transformation, previewed in a player, and downloaded as a file, using a real one-hour video on the chosen plan.
Acceptance: written result documenting what works, limits found, and the fallback decision.

**3.2 Clip CRUD**
Create, list, update and delete clips with the validation rules from section 5.
Acceptance: invalid ranges are rejected with clear error messages.

**3.3 Clip URL generation**
Service that builds the playback URL and the download URL from a clip record.
Acceptance: the returned URLs play and download exactly the selected range.

**3.4 Video player and timeline**
Player page with seeking, current time display, and a timeline showing existing clips.
Acceptance: the user can navigate a one-hour video smoothly.

**3.5 Clip creation UI**
Start and end inputs in `mm:ss`, buttons to set start or end from the playhead, range preview, title field, save.
Acceptance: a clip can be created in under 15 seconds from a known timestamp.

**3.6 Clip management UI**
Clip list with preview, rename, adjust range, delete and download.
Acceptance: all actions work without page reloads and show loading and error states.

**3.7 Clip tests**
Tests for validation, ownership checks and URL generation.
Acceptance: a user can never read or modify another user's clips.

### Phase 4: MVP Hardening

**4.1 Ownership and authorization review**
Audit every route for ownership checks.
Acceptance: automated tests prove cross-user access is blocked.

**4.2 Usage tracking**
Record uploaded minutes and clip counts per user.
Acceptance: usage can be queried per user and per month.

**4.3 Error handling and empty states**
Consistent loading, empty and error states across the UI.
Acceptance: no unhandled error is shown as a blank screen.

**4.4 Observability**
Structured logging and error reporting for the API and frontend.
Acceptance: a failed request can be traced from the UI to the API log.

**4.5 Deployment**
Deploy the API, database and frontend to a staging environment.
Acceptance: colleagues can register and complete the full flow on staging.

**4.6 MVP acceptance test**
End-to-end run: register, upload a one-hour podcast, create five clips, download them.
Acceptance: the run completes with no manual fixes. **Do not start Phase 5 before this passes.**

### Phase 5: Transcription

**5.1 Queue infrastructure**
Add Redis and BullMQ, a `ProcessingJob` table, and a job status model: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`.
Acceptance: jobs survive an API restart.

**5.2 Audio extraction**
Produce a compressed mono audio track from the video.
Acceptance: audio is small enough to be split into chunks under the Groq file size limit.

**5.3 Audio chunking**
Split audio into chunks with a small overlap and record each chunk's offset.
Acceptance: chunk offsets allow exact timeline reconstruction.

**5.4 Groq transcription**
Transcribe each chunk with word-level and segment-level timestamps, with the language set explicitly.
Acceptance: each chunk stores its own result and status.

**5.5 Chunk-level retry**
Failed chunks retry with exponential backoff and handle rate limit responses. Completed chunks are never re-processed.
Acceptance: a forced failure on one chunk only re-runs that chunk.

**5.6 Transcript merge and storage**
Merge chunks into one transcript with corrected timestamps and remove overlap duplicates. Store in `Transcript` and `TranscriptSegment`.
Acceptance: timestamps match the real video within a small tolerance.

**5.7 Progress and status API**
Expose job progress to the frontend through polling or server-sent events.
Acceptance: the user sees live progress and a clear failure state with a retry button.

**5.8 Transcript viewer**
Show the transcript next to the player. Clicking a line seeks the video.
Acceptance: transcript and video stay in sync.

### Phase 6: AI Topic Segmentation

**6.1 Segmentation prompt design**
Design the prompt and a strict JSON output schema (`title`, `startSec`, `endSec`, `summary`).
Acceptance: documented prompt with example inputs and outputs.

**6.2 Transcript windowing**
Split long transcripts into overlapping windows that fit within Groq token limits.
Acceptance: a one-hour transcript is processed within the free tier limits.

**6.3 Boundary reconciliation**
Merge window results into one ordered list of contiguous segments covering the whole video with no gaps and no overlaps.
Acceptance: the first segment starts at 0 and the last ends at video duration.

**6.4 Validation layer**
Validate AI output with a schema, enforce minimum and maximum clip length, split oversized topics, merge tiny ones. If the output is invalid, retry the request.
Acceptance: invalid AI output never reaches the database.

**6.5 Boundary snapping**
Snap boundaries to the nearest sentence end from the transcript.
Acceptance: clips never start or end in the middle of a sentence.

**6.6 AI clip creation**
Create clips with `source = AI` from the validated segments.
Acceptance: the user gets a full set of suggested clips after one action.

**6.7 Manual override**
The user can edit start and end of any AI clip, add clips, merge clips, split clips, and delete clips. Manual clipping from Phase 3 continues to work unchanged.
Acceptance: edits persist and are never overwritten by re-running AI unless the user confirms.

**6.8 Re-run and cost control**
Allow re-running segmentation, with usage limits and stored results.
Acceptance: repeated runs are counted and can be limited per user.

### Phase 7: 9:16 Reframing

**7.1 Reframing strategy decision**
Choose the approach after testing on real podcast videos: center crop, split screen (one speaker above the other), or active speaker tracking.
Acceptance: written decision with sample outputs.

**7.2 Center crop or split screen renderer**
Render a clip to 9:16 with the chosen simple strategy.
Acceptance: output plays correctly on vertical platforms.

**7.3 Render pipeline**
Render jobs on the queue with status, retry and output storage.
Acceptance: a failed render can be retried without re-uploading anything.

**7.4 Reframing options in the UI**
Per-clip and bulk reframing controls with preview.
Acceptance: the user can render one clip or all clips.

**7.5 Active speaker tracking (optional)**
Face detection and speaker detection to follow the person who is talking.
Acceptance: only started after 7.2 to 7.4 are stable.

### Phase 8: Subtitles

**8.1 Subtitle generation**
Build subtitle cues from word-level timestamps for each clip, with time offsets relative to the clip start.
Acceptance: cue timing matches the audio.

**8.2 Arabic and RTL rendering test**
Verify font support, letter joining and right-to-left direction in the rendered output before building the full feature.
Acceptance: a sample clip renders correctly.

**8.3 Subtitle styling**
Configurable font, size, colour, position and background.
Acceptance: at least three presets available.

**8.4 Toggle and rendering**
A per-clip and global toggle to burn subtitles into the output.
Acceptance: the same clip can be rendered with and without subtitles.

**8.5 Subtitle editing**
Let the user correct subtitle text before rendering.
Acceptance: edited text is used in the final render.

### Phase 9: Subscriptions and Production

**9.1 Plans and limits**
Define plans by processed minutes per month, storage and features.
Acceptance: limits are enforced on upload, transcription and AI runs.

**9.2 Payment integration**
Integrate a payment gateway with subscriptions and webhooks.
Acceptance: successful payment activates a plan, cancellation and failure are handled.

**9.3 Billing UI**
Plan selection, current usage, invoices and cancellation.
Acceptance: the user always sees remaining usage.

**9.4 Capacity upgrade**
Move to paid Cloudinary and paid Groq capacity, sized from measured usage.
Acceptance: cost per processed minute is known and covered by plan pricing.

**9.5 Production hardening**
Backups, monitoring, alerts, rate limits, abuse protection, privacy policy, terms of service and data deletion.
Acceptance: production checklist completed.

---

## 9. Known Risks

| Risk | Mitigation |
|------|------------|
| Cloudinary free plan file size and credit limits | Test with a real one-hour video in Phase 3.1, plan for a paid tier before public launch |
| Groq audio file size limit | Compress audio and chunk it (Phase 5.2 and 5.3) |
| Groq free tier token and rate limits | Windowing, backoff and per-user limits (Phase 5.5 and 6.2) |
| Arabic dialect transcription errors | Set language explicitly, allow manual transcript and subtitle edits |
| AI produces invalid or overlapping segments | Strict schema validation and reconciliation (Phase 6.3 and 6.4) |
| Long-running work timing out | All heavy work runs in queue workers, never in HTTP requests |
| Free AI does not scale with paying users | Usage limits from Phase 4.2, paid capacity in Phase 9.4 |

---

## 10. Glossary

- **Clip**: a time range of a video, saved with a title.
- **Reel**: a clip exported in vertical 9:16 format.
- **Segment**: a topic-based time range suggested by the AI.
- **Chunk**: a small piece of audio processed independently so failures can be retried in isolation.
- **Job**: a background task with a persistent status.
