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
| Backend | NestJS 11, TypeScript |
| Database | PostgreSQL 16 with Prisma 7 (driver adapter `@prisma/adapter-pg`) |
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

- **Two packages, one repository.** `backend` and `frontend` are independent npm packages. There are no npm workspaces, so each can be deployed on its own.
- **API port.** The API listens on `4000` by default and the frontend on `3000`.
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

Login sets `access_token` and `refresh_token` as httpOnly cookies (`secure` in production, `sameSite=lax`); the refresh cookie is scoped to `/api/v1/auth`. Tokens are never returned in the response body. Wrong email or password returns a generic `401`.

Refresh rotates the refresh token on every call and returns `204` with new cookies. Each refresh token is single use: presenting an already rotated token revokes the whole session (reuse detection) and returns `401`, and there is no grace window, so concurrent refreshes with the same token count as reuse. Failed refreshes clear both cookies. Logout revokes the session of the presented refresh token, clears the cookies and always returns `204`. `GET /auth/me` requires a valid access token whose session is still active, so logout takes effect immediately.

Every route requires a valid session by default (global JWT guard). Routes opt out with the `@Public()` decorator; today only `register`, `login`, `refresh`, `logout` and `health` are public. Register, login, refresh and logout are rate limited per client IP and per route, and return `429` with a `Retry-After` header when the limit is exceeded. `GET /auth/me` is not rate limited. Behind a reverse proxy, enable Express `trust proxy` so the client IP is read correctly.

Registration rules: `email` is trimmed, lowercased and must be a valid address (max 254 characters). `password` must be 8 to 128 characters and contain at least one letter and one number. Duplicate emails return `409`. The response is `{ id, email, createdAt }` and never includes the password or its hash.

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
| GET | `/clips/:id/playback` | Get a trimmed playback URL |
| GET | `/usage?month=YYYY-MM` | Get the current user's monthly upload minutes and clip count |

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

### 7.3 Backend structure

`backend/src` contains production code only. Every test lives under `backend/test`, grouped by test type and then by the source module it covers.

```text
backend/
  src/
    auth/
      dto/
    common/
      filters/
      middleware/
      pipes/
    config/
    health/
    prisma/
    storage/
    users/
  test/
    unit/
      app/
      auth/
      common/
        filters/
      config/
      storage/
    e2e/
    support/
    setup-env.ts
    jest-e2e.json
```

- Add a unit test at `test/unit/<module>/<file>.spec.ts`; its directory mirrors the module under `src`.
- Add an end-to-end test at `test/e2e/<feature>.e2e-spec.ts`.
- Put shared fakes, fixtures and test helpers in `test/support`; do not place them in `src`.
- Production files never use `.spec.ts` or `.e2e-spec.ts` names.
- `npm test` runs unit tests only. `npm run test:e2e` runs end-to-end tests only.

### 7.4 Code style

- TypeScript strict mode on both apps. No `any` without a strong reason.
- DTO validation with `class-validator` in NestJS, shared schemas with `zod` on the frontend.
- One module per domain in NestJS (`auth`, `users`, `videos`, `clips`, `storage`).
- Business logic lives in services, controllers stay thin.
- Environment variables are validated at startup. Secrets are never committed.
- ESLint and Prettier are mandatory and enforced in CI.

### 7.5 Git

- Branch per task: `feat/<task-id>-short-name`.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.
- Small pull requests. One task per pull request when possible.

### 7.6 Definition of done

A task is done only when:

- Acceptance criteria are met
- Input validation and error handling are in place
- Tests are written for the business logic
- Lint and type checks pass
- Documentation is updated if behaviour or setup changed

---

## 8. Task Breakdown

Each task has an ID, a description and acceptance criteria. Tasks inside a phase are ordered. Do not start a phase before the previous one is complete.

### Phase 0: Foundation (done)

**0.1 Repository setup**
Create one repository with two independent packages: `backend` (NestJS) and `frontend` (Next.js), plus a thin root package for shared scripts and git hooks.
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

Status: 1.1 to 1.6, 2.1 to 2.7, and 3.2 to 3.7 done. Task 3.1 is validated with a 28-minute real upload and needs a one-hour confirmation upload to meet its final acceptance criterion.

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

#### 3.1 Spike result (2026-09-28)

Tested against a real uploaded MP4 (`1280x720`, `96.2 MB`, `1680.145` seconds) in the configured Cloudinary product environment.

| Check | Result |
|-------|--------|
| Playback URL for seconds `60` to `75` | Passed: returned `206` with `video/mp4`; generated clip size was `1,071,696` bytes |
| Attachment download URL for the same range | Passed: returned `206` with `Content-Disposition: attachment; filename="podcast-reel-60-75.mp4"` after the derived asset was generated |
| Streaming attachment URL | Passed: returned `200` with attachment disposition immediately |

The first request to a normal `fl_attachment` URL returned Cloudinary `423` while the derived clip was generated. The client must either retry that response or use `fl_streaming_attachment` for download actions. Preview URLs can be generated with `so` and `eo` offsets. Download URLs should use the same offsets plus `fl_streaming_attachment` and a sanitized filename.

**Decision:** use Cloudinary dynamic URL transformations for Phase 3 playback and downloads. No FFmpeg worker is needed for the MVP. The tested source is 28 minutes long rather than the planned one-hour acceptance asset, so repeat this exact check with a one-hour production-like upload before closing the Phase 3.1 acceptance criterion.

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

#### 4.1 Review result (2026-09-28)

All resource routes require the authenticated user context. Video read, rename, delete, resume, completion and playback queries include the requesting `userId`. Clip create and list operations first resolve the owned video; clip update, delete, playback and download queries filter through `clip.video.userId`. Authentication session routes are scoped by the signed session identity. E2E tests cover cross-user rejection for video mutation, upload resume, clip list/update/delete and playback/download URLs.

**4.2 Usage tracking**
Record uploaded minutes and clip counts per user.
Acceptance: usage can be queried per user and per month.

#### 4.2 Implementation result (2026-09-28)

`UsageRecord` stores one counter record per user and UTC calendar month. A verified video adds its full duration in seconds exactly when it becomes `READY`; each newly created clip increments the clip counter. `GET /usage?month=YYYY-MM` returns only the authenticated user's counters, with uploaded duration exposed as fractional minutes. Missing records return zero usage. The `UsageRecord` migration has been applied to the development database.

**4.3 Error handling and empty states**
Consistent loading, empty and error states across the UI.
Acceptance: no unhandled error is shown as a blank screen.

#### 4.3 Implementation result (2026-09-28)

Authentication, workspace, upload and video-editor views now render an accessible loading state while their session or data is resolving. Their request failures are shown inline, empty libraries and clip lists are explicit, and upload-settings failures include a retry action. No route intentionally falls through to a blank screen during those states.

**4.4 Observability**
Structured logging and error reporting for the API and frontend.
Acceptance: a failed request can be traced from the UI to the API log.

#### 4.4 Implementation result (2026-09-28)

The API assigns or preserves `x-request-id` for every response and emits structured JSON request logs containing the method, path, status, duration and request ID. Server failures emit a structured error log with the same ID while keeping internal exception details out of the HTTP response. The frontend retains the ID from the error body or response header and displays it as `Reference ID` beside the user-safe error, so a reported UI failure can be located in the API log.

**4.5 Deployment**
Deploy the API, database and frontend to a staging environment.
Acceptance: colleagues can register and complete the full flow on staging.

#### 4.5 Staging readiness (2026-09-28)

The API now has a production Docker image plus a separate migration target, and the staging environment variables and verification runbook are documented in `docs/STAGING.md`. Both production builds pass locally. Deployment is intentionally skipped for now: the developer laptop is the active runtime environment, so there is no staging provider or colleague acceptance environment yet.

**4.6 MVP acceptance test**
End-to-end run: register, upload a one-hour podcast, create five clips, download them.
Acceptance: the run completes with no manual fixes. **Do not start Phase 5 before this passes.**

#### 4.6 Local automated coverage (2026-09-28)

The backend acceptance test now runs the whole authenticated flow with a verified 3,600-second asset: registration, video creation, upload confirmation, five clip creations, five download URL requests and monthly usage assertions. It uses the local test storage adapter, so it does not replace the remaining manual browser and Cloudinary check with a real one-hour file. Run that local check before marking 4.6 accepted or beginning Phase 5.

### Phase 5: Transcription

**5.1 Queue infrastructure**
Add Redis and BullMQ, a `ProcessingJob` table, and a job status model: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`.
Acceptance: jobs survive an API restart.

#### 5.1 Implementation result (2026-09-28)

Docker Compose now runs Redis with AOF persistence alongside PostgreSQL. The API validates `REDIS_URL`, stores every background task in `ProcessingJob`, and enqueues work through BullMQ using the database job id as the Bull job id. On startup the API resets interrupted `RUNNING` rows back to `PENDING` and ensures each persisted job is present in Redis again. Automated tests cover job creation, recovery and the in-memory queue adapter used while `NODE_ENV=test`.

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

#### 6.1 Implementation result (2026-09-29)

`docs/AI_SEGMENTATION_PROMPT.md` defines the system prompt, transcript-window input contract and a strict JSON response schema with `title`, `startSec`, `endSec` and `summary`. It also defines timestamp and language rules plus an Arabic example input and valid output. Runtime validation and window reconciliation remain the responsibilities of Tasks 6.2 through 6.4.

**6.2 Transcript windowing**
Split long transcripts into overlapping windows that fit within Groq token limits.
Acceptance: a one-hour transcript is processed within the free tier limits.

#### 6.2 Implementation result (2026-09-29)

`TranscriptWindowingService` groups ordered transcript segments into character-bounded windows, carrying up to 30 seconds of earlier context when it fits. The default 12,000-character budget estimates at most 6,000 tokens conservatively, and can be changed through `SEGMENTATION_WINDOW_MAX_CHARS` and `SEGMENTATION_WINDOW_OVERLAP_SEC`. Unit coverage constructs a 3,600-second transcript and verifies that every source segment is represented without any window exceeding the configured budget.

**6.3 Boundary reconciliation**
Merge window results into one ordered list of contiguous segments covering the whole video with no gaps and no overlaps.
Acceptance: the first segment starts at 0 and the last ends at video duration.

#### 6.3 Implementation result (2026-09-29)

`BoundaryReconciliationService` merges duplicate topic candidates returned from adjacent overlapping windows, orders the remaining candidates and calculates shared midpoint boundaries. Its output covers the entire video contiguously: the first topic starts at `0`, every subsequent topic starts exactly when the previous one ends, and the last topic ends at the video duration. Unit tests cover overlap, gaps, duplicate windows and invalid candidates.

**6.4 Validation layer**
Validate AI output with a schema, enforce minimum and maximum clip length, split oversized topics, merge tiny ones. If the output is invalid, retry the request.
Acceptance: invalid AI output never reaches the database.

#### 6.4 Implementation result (2026-09-29)

`TopicSegmentValidationService` accepts only the strict response contract defined in Task 6.1, rejects extra fields and non-contiguous output, merges topics shorter than the configured clip minimum and splits topics above the configured maximum. `requestValidSegments` retries an AI provider response up to `SEGMENTATION_VALIDATION_MAX_ATTEMPTS` times, returning only validated segments. Database persistence is not connected to AI suggestions until Task 6.6, so invalid output has no persistence path.

**6.5 Boundary snapping**
Snap boundaries to the nearest sentence end from the transcript.
Acceptance: clips never start or end in the middle of a sentence.

#### 6.5 Implementation result (2026-09-29)

`BoundarySnappingService` moves each shared internal topic boundary to the nearest timestamped transcript sentence end, recognizing Arabic and English sentence punctuation. If a transcript has no punctuation markers, it falls back to its timestamped segment endings. The first and last video boundaries remain fixed, and every snapped result remains contiguous. Unit tests cover punctuation, fallback behavior and invalid input coverage.

**6.6 AI clip creation**
Create clips with `source = AI` from the validated segments.
Acceptance: the user gets a full set of suggested clips after one action.

#### 6.6 Implementation result (2026-09-29)

`POST /api/v1/videos/:videoId/ai-clips` runs the windowed Groq topic pipeline only for an owned ready video with a completed transcript. It validates schema and duration rules before persistence, snaps and validates boundaries once more, then creates the full set of clips as `source = AI`. The workspace exposes this as one `Create AI clips` action beside the transcript and immediately adds the resulting clips to the timeline. Manual clip creation remains unchanged.

**6.7 Manual override**
The user can edit start and end of any AI clip, add clips, merge clips, split clips, and delete clips. Manual clipping from Phase 3 continues to work unchanged.
Acceptance: edits persist and are never overwritten by re-running AI unless the user confirms.

#### 6.7 Implementation result (2026-09-29)

Manual clip creation, editing and deletion continue to use the original endpoints. Editing an AI suggestion changes its source to `MANUAL`, making the override explicit. `POST /api/v1/clips/:id/split` creates two valid manual clips at the chosen point; `POST /api/v1/videos/:videoId/clips/merge` combines selected owned clips in a transaction. The workspace adds a split action at the player position and checkbox-based merge selection. AI re-runs currently add a new suggestion set rather than replacing existing clips, so they cannot overwrite manual edits; explicit re-run confirmation and usage limits remain Task 6.8.

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

---

## 11. Local Development

1. Install Node.js 22 (see `.nvmrc`) and Docker.
2. Install dependencies: `npm run install:all`.
3. Start PostgreSQL and Redis: `npm run db:up`.
4. Backend: copy `backend/.env.example` to `backend/.env` and fill in the Cloudinary values, then run `npm --prefix backend run db:migrate` and `npm run dev:backend`.
5. Frontend: copy `frontend/.env.example` to `frontend/.env.local`, then run `npm run dev:frontend`.
6. Verify: `GET http://localhost:4000/api/v1/health` returns `{ "status": "ok", "database": "up", ... }`.

### Useful commands

| Command | Description |
|---------|-------------|
| `npm run check` | Lint, type check and format check for both apps (also runs as the pre-commit hook) |
| `npm test` | Backend unit and end-to-end tests |
| `npm --prefix backend run db:migrate` | Create and apply a development migration |
| `npm --prefix backend run db:generate` | Regenerate the Prisma client |

The Prisma client is generated into `backend/src/generated/prisma` and is not committed. It is regenerated by `db:migrate`, `db:generate` and `npm run build`.

### Environment variables

Backend (`backend/.env`):

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | no | `development`, `test` or `production` (default `development`) |
| `PORT` | no | API port (default `4000`) |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `REDIS_URL` | yes | Redis connection string for BullMQ |
| `CORS_ORIGIN` | yes | Comma-separated list of allowed frontend origins |
| `JWT_ACCESS_SECRET` | yes | Secret for signing access tokens (at least 32 characters) |
| `ACCESS_TOKEN_TTL_SEC` | no | Access token lifetime in seconds (default `900`) |
| `REFRESH_TOKEN_TTL_SEC` | no | Refresh token and session lifetime in seconds (default `2592000`) |
| `AUTH_RATE_LIMIT_TTL_SEC` | no | Rate limit window for auth routes in seconds (default `60`) |
| `AUTH_RATE_LIMIT_MAX` | no | Requests allowed per window, per client and per route (default `10`) |
| `CLOUDINARY_CLOUD_NAME` | yes | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | yes | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | yes | Cloudinary API secret (server only) |
| `CLOUDINARY_UPLOAD_PRESET` | no | Optional upload preset name; when set it is included in the signature |
| `CLOUDINARY_UPLOAD_FOLDER` | no | Folder for uploaded videos (default `podcast-reels`) |
| `GROQ_API_KEY` | yes | Groq API key for transcription and future topic segmentation |
| `GROQ_SEGMENTATION_MODEL` | no | Groq structured-output model for topic segmentation (default `openai/gpt-oss-20b`) |
| `SEGMENTATION_WINDOW_MAX_CHARS` | no | Maximum transcript characters sent in one topic-analysis window (default `12000`) |
| `SEGMENTATION_WINDOW_OVERLAP_SEC` | no | Earlier transcript context retained between topic-analysis windows in seconds (default `30`) |
| `SEGMENTATION_MAX_COMPLETION_TOKENS` | no | Completion token cap for each topic-analysis request; keeps reasoning models from exhausting the output budget (default `3000`) |
| `SEGMENTATION_CONCURRENCY` | no | Number of transcript windows analysed in parallel; keep at `1` on low Groq rate-limit tiers (default `1`) |
| `SEGMENTATION_VALIDATION_MAX_ATTEMPTS` | no | Number of invalid topic-analysis responses retried before failing (default `3`) |
| `VIDEO_ALLOWED_FORMATS` | no | Comma-separated extensions allowed for video uploads (default `mp4,mov,webm`) |
| `VIDEO_MAX_SIZE_BYTES` | no | Largest accepted video file in bytes (default `5368709120`, 5 GiB) |
| `VIDEO_MAX_DURATION_SEC` | no | Longest accepted video duration in seconds (default `14400`, 4 hours) |
| `CLIP_MIN_DURATION_SEC` | no | Shortest allowed clip duration in seconds (default `5`) |
| `CLIP_MAX_DURATION_SEC` | no | Longest allowed clip duration in seconds (default `180`) |
| `STALE_UPLOAD_THRESHOLD_SEC` | no | Age after which an incomplete upload is abandoned (default `86400`, 24 hours) |
| `STALE_UPLOAD_CLEANUP_INTERVAL_SEC` | no | Frequency for the stale-upload cleanup job (default `3600`, 1 hour) |

Frontend (`frontend/.env.local`):

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | yes | Base URL of the API, including `/api/v1` |

Both apps validate their environment at startup and refuse to run when a required value is missing or invalid.
