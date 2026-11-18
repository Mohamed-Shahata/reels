# ReelCast — Master Project Specification

## 1. المنتج (V1)

**ReelCast**: SaaS المستخدم يرفع فيديو طويل (بودكاست أو شخص واحد بيتكلم)، السيستم يقطعه لـ reels عمودية 9:16 جاهزة للنشر.

### اللي V1 لازم يعمله

| #   | Feature                | تفصيل                                                                          |
| --- | ---------------------- | ------------------------------------------------------------------------------ |
| 1   | Auth                   | register / login / refresh / logout (موجود وشغال، يتحافظ عليه)                 |
| 2   | Upload فيديو كبير      | resumable, retry, progress (S3 multipart)                                      |
| 3   | نوع المحتوى            | المستخدم يختار وقت الرفع: **Podcast** (شخصين) أو **Solo** (شخص واحد)           |
| 4   | Transcript             | Whisper (Groq) بـ word timestamps، عربي/إنجليزي                                |
| 5   | تقسيم لـ clips بالـ AI | حسب المواضيع، مدة reel من 20 لـ 90 ثانية (قابلة للتعديل)                       |
| 6   | Auto reframing         | **Solo**: كاميرا ثابتة على الوش. **Podcast**: الكاميرا تروح على المتكلم الحالي |
| 7   | Subtitles              | generate تلقائي + تعديل النص + 3 styles جاهزة + burn-in                        |
| 8   | Export                 | MP4 1080×1920، وexport للـ transcript (SRT / VTT / TXT)                        |
| 9   | Retry + error handling | RabbitMQ: retry بـ backoff، DLQ، idempotency، cancel                           |
| 10  | حفظ وحذف الملفات       | كل ملف متتبع، حذف كامل بدون orphans، retention للـ exports                     |

### مش في V1

دفع/اشتراكات (Phase 9 القديم)، نشر مباشر على السوشيال، تعدد لغات الـ UI أكتر من ar/en، timeline editor متقدم، B-roll، emojis/animations للـ subtitles.

---

## 2. الوضع الحالي (اللي فهمته من الكود)

**Stack:** NestJS 11 + Prisma 7 + Postgres، Next.js 16 (App Router) + Tailwind 4، Cloudinary للتخزين والريندر، BullMQ+Redis للـ jobs، Groq (Whisper + LLM) للترانسكريبت والتقسيم، FFmpeg محلي في fallback بس.

**الموجود وشغال/مفيد (يتحافظ عليه):**

- Auth كامل (argon2، refresh rotation + reuse detection، rate limit، global guard).
- Segmentation (windowing / validation / planner / snapping / reconciliation) + tests.
- Subtitle cue builder + edits + style logic (pure functions).
- Usage tracking، i18n ar/en في الفرونت، feedback components (toast/dialog/skeleton)، API client، tests كتير.

**الفلو الحالي:**

```
Browser → Cloudinary (chunked) → POST /videos/:id/complete → ProcessingJob(TRANSCRIPTION) → BullMQ
   → Worker (جوه نفس الـ API process): audio من Cloudinary → chunks 10min → Groq → Transcript → (لو autoClips) AI segmentation
Clip = startSec/endSec بس. Render = Cloudinary eager transformation (c_fill,g_auto:faces) + ترجمة كـ text layers
```

---

## 3. الأخطاء الحالية والحل

الـ severity: 🔴 Critical (يبوّظ الـ SaaS) · 🟠 High · 🟡 Medium.

### 3.1 Backend

| ID  | Sev | المشكلة                                                                                                                                                                                                                                                                                                                | الدليل                                                                                                          | الحل                                                                                        | Task     |
| --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| B1  | 🔴  | ملفات `.env` و `.env.local` جوه الـ zips (فيها Groq + Cloudinary + JWT secrets).                                                                                                                                                                                                                                       | `be/.env`, `fe/.env.local`                                                                                      | Rotate كل المفاتيح فورًا. شيل الملفات من الـ repo، `.gitignore`، `.env.example`.            | 0.1      |
| B2  | 🔴  | **مفيش retry حقيقي.** الـ job بيتضاف من غير `attempts`/`backoff`، والـ processor أول ما يفشل يعمل `markFailed` ويرمي error. Retry يدوي بس من الـ UI. `attempts` في DB بتتزود بس مش بتتحكم في حاجة.                                                                                                                     | `bull-processing-queue.service.ts` (`queue.add` من غير options)، `processing.processor.ts` (catch → markFailed) | RabbitMQ retry topology (القسم 4.4) + تصنيف errors (retryable / fatal).                     | 1.x      |
| B3  | 🔴  | الـ worker شغال **جوه الـ API process**. FFmpeg وتحميل الصوت وGroq بيزاحموا الـ API. أي crash/deploy بيقتل شغل شغال.                                                                                                                                                                                                   | `processing-bull.register.ts` (`ProcessingProcessor` provider جوه AppModule)                                    | Process منفصل `worker.ts` بـ module خاص. API ما بيعملش consume أبدًا.                       | 1.3      |
| B4  | 🔴  | **الحذف ناقص.** `videos.remove` بيمسح asset الأصلي من Cloudinary بس. الـ renders (Cloudinary derived + ملفات local)، الـ subtitle assets، الـ thumbnails، والـ temp files مش بتتمسح. الـ jobs الشغالة مش بتتلغي. لو الـ destroy نجح والـ DB delete فشل → record يشاور على ملف مش موجود.                                | `videos.service.ts#remove`, `clips.service.ts#remove` (thumbnail محلي بس)                                       | جدول `MediaAsset` + `CLEANUP` queue + soft delete (القسم 6).                                | 2.x, 5.5 |
| B5  | 🟠  | مفيش cleanup للـ temp files لما الـ job يفشل. `cleanupTempFiles` بتتنادى بس في مسار النجاح. الملف الصوتي اسمه ثابت `${videoId}.mp3` في `os.tmpdir()`.                                                                                                                                                                  | `processing.processor.ts`, `transcription.service.ts#extractAudio`                                              | temp dir لكل job، مسحه في `finally`، startup sweep.                                         | 3.2      |
| B6  | 🟠  | **`recoverPersistedJobs` على كل boot** بيحوّل أي `RUNNING` لـ `PENDING` ويعيد enqueue. لو في أكتر من instance أو worker لسه شغال → نفس الـ job يتنفذ مرتين.                                                                                                                                                            | `processing-jobs.service.ts`, `processing-startup.service.ts`                                                   | Lease + heartbeat + reaper (4.5) بدل recovery وقت الـ boot.                                 | 1.5      |
| B7  | 🟠  | إنشاء الـ job مش atomic: row في DB وبعدين enqueue. لو الـ enqueue فشل → `PENDING` يتيم. كمان `startTranscription` بيسمح بـ jobs مكررة لنفس الفيديو.                                                                                                                                                                    | `processing-jobs.service.ts#createJob`, `videos.service.ts#startTranscription`                                  | Transactional Outbox + unique `idempotencyKey` (4.3).                                       | 1.2, 1.4 |
| B8  | 🟠  | الريندر المحلي بيتجاهل الترجمة (`burnIn` بيتحسب ومش بيتستخدم في الفرع المحلي) وبيعمل center crop بس. FFmpeg مش بيتقتل لما اليوزر يوقف الـ job (الـ stop بيتشيك قبل وبعد بس). الـ `progress` handler async من غير catch.                                                                                                | `clip-render-executor.service.ts`                                                                               | FFmpeg render worker جديد بـ cancel (kill) وprogress صح (5.x).                              | 5.x      |
| B9  | 🟠  | **مفيش face tracking ولا podcast logic.** الـ reframing = `c_fill,g_auto:faces` من Cloudinary (قرار موثق في `REFRAMING_STRATEGY.md`) ودا مش بيعمل "الكاميرا على المتكلم" ولا "ثابتة على شخص". الترجمة بتتحقن كـ text layers في الـ URL (حدود طول URL، حل SRT كـ fallback). Derived renders بتتخزن في Cloudinary للأبد. | `storage.service.ts#startClipReelRender`, `docs/REFRAMING_STRATEGY.md`                                          | Analyzer + FFmpeg (القسم 5). نشيل Cloudinary transformations.                               | 4.x, 5.x |
| B10 | 🟡  | الـ auto-clips بتتنفذ **جوه job الترانسكريبشن بعد `markCompleted`**. لو فشلت (حد الـ AI الشهري مثلًا) بتتلوج `warn` بس. اليوزر يشوف "Completed" ومفيش clips ومفيش سبب.                                                                                                                                                 | `processing.processor.ts#runAutoClips`                                                                          | `SEGMENT` stage مستقل بـ status وerror وretry.                                              | 3.4      |
| B11 | 🟡  | `reserveAiRun` بيخصم من الكوتا **قبل** الـ segmentation وملهاش refund لو فشل.                                                                                                                                                                                                                                          | `ai-clip-runs.service.ts`, `usage.service.ts`                                                                   | Reserve → commit/release حسب نتيجة الـ job.                                                 | 3.4      |
| B12 | 🟡  | الترانسكريبشن sequential، ونتايج الـ chunks مش بتتخزن. لو فشل عند chunk 9 من 10 كل حاجة بتتعاد (وفلوس Groq). الـ rate limit بيتكشف بـ regex على نص الـ error (`includes('rate')`) ومش بيحترم `Retry-After`.                                                                                                            | `transcription.service.ts`                                                                                      | Chunk-level checkpointing في DB/storage، تصنيف errors من status code، احترام `Retry-After`. | 3.3      |
| B13 | 🟡  | `ENABLE_LOCAL_STORAGE_FALLBACK` الـ default بتاعه `true`. في production الملفات تتخزن على disk مؤقت من غير ما حد ياخد باله.                                                                                                                                                                                            | `config/env.schema.ts`                                                                                          | نشيل الـ local fallback خالص (dev بيستخدم MinIO).                                           | 0.4      |
| B14 | 🟡  | `StaleUploadCleanupService` بـ `setInterval` جوه كل instance من غير lock. بيحوّل `UPLOADING` لـ `FAILED` بس. الـ `FAILED` rows وملفاتها مبتتمسحش أبدًا.                                                                                                                                                                | `stale-upload-cleanup.service.ts`                                                                               | Scheduled job في الـ worker + purge للـ FAILED/soft-deleted (6.3).                          | 2.6      |
| B15 | 🟡  | "Stop" متخزن كـ `FAILED` برسالة سحرية `'Stopped by the user'`. مفيش status `CANCELLED`.                                                                                                                                                                                                                                | `processing.constants.ts`                                                                                       | status حقيقي `CANCELLED`.                                                                   | 1.2      |
| B16 | 🟡  | الاسم `bullJobId` في الـ schema بيربط الـ DB بـ BullMQ. مفيش `errorCode`، مفيش event log للـ job.                                                                                                                                                                                                                      | `schema.prisma`                                                                                                 | rename + `JobEvent` table.                                                                  | 1.2      |

### 3.2 Frontend

| ID  | Sev | المشكلة                                                                                                                                                                                                                                                                                                | الدليل                                                             | الحل                                                          | Task |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------- | ---- |
| F1  | 🔴  | **Redesign نص مخلص = السبب الرئيسي إن التصميم "عك".** `globals.css` و `body` dark، لكن 22 ملف لسه فيهم الـ light-green theme القديم hardcoded (`bg-white` ×54، `text-[#5d6d68]` ×104، `bg-[#0f766e]` ×35، `border-[#d8e1dc]`…) ومفيش ولا `dark:` واحد. النتيجة: كروت بيضا على خلفية سودا وheader أبيض. | `app-header.tsx`, `app/page.tsx`, `video-card.tsx`…                | Design system بـ tokens وإعادة بناء الشاشات (القسم 7).        | 6.x  |
| F2  | 🟠  | **God component:** `app/videos/[id]/page.tsx` = 1960 سطر و 41 hook. كمان components 600–760 سطر (`upload-video-form`, `clip-render-controls`, `trim-panel`, `video-stage`). صعب تتعدل وصعب AI يمشي عليه.                                                                                               | الملفات دي                                                         | تقسيم لـ feature modules + hooks (6.5).                       | 6.5  |
| F3  | 🟠  | **كتير features ظاهرة مرة واحدة**: trimmer منفصل، style panel، burn-in، export subtitles، transcript export، download dialog، split/merge. معقد على V1.                                                                                                                                                | `components/videos/*`                                              | تبسيط (7.3): clip editor واحد + export dialog واحد.           | 6.4  |
| F4  | 🟡  | polling بـ `setInterval` في أكتر من مكان (3s و 5s) من غير backoff أو إيقاف لما التاب مش ظاهر.                                                                                                                                                                                                          | `app/page.tsx`, `app/videos/[id]/page.tsx`, `use-video-renders.ts` | hook واحد `useJobPolling` (backoff + visibility)، SSE بعد V1. | 6.5  |
| F5  | 🟡  | strings hardcoded بره الـ i18n (`"Loading video workspace..."`, `STYLE_SAMPLE_CAPTION` بالعربي). والـ branding مختلط (`ReelCast` في الـ UI و`Podcast Reels` في الـ metadata).                                                                                                                          | `app/videos/[id]/page.tsx`, `layout.tsx`                           | كل النصوص i18n، اسم واحد.                                     | 6.1  |
| F6  | 🟡  | Upload client مبني على Cloudinary + local chunks.                                                                                                                                                                                                                                                      | `lib/chunked-upload.ts`                                            | S3 multipart presigned.                                       | 2.3  |

### 3.3 Docs

`docs/PROJECT.md` و `REFRAMING_STRATEGY.md` قديمين ومتناقضين مع الخطة دي (BullMQ، Cloudinary URL transformation، "MVP يدوي"). كمان `.agents/` (ملفات agents سابقة) و `.husky/_` و `tsconfig.tsbuildinfo` و `src/generated/` مش المفروض في الـ repo. → Task 0.2, 0.3, 7.5.

---

## 4. Architecture الجديدة

```
                ┌──────────────┐        presigned multipart         ┌─────────────────┐
 Browser ─────► │  API (Nest)  │ ◄────────────────────────────────► │ Object Storage  │
   ▲  poll/SSE  │  REST only   │                                     │ S3 / R2 / MinIO │
   │            └──────┬───────┘                                     └────────▲────────┘
   │                   │ tx: DB + OutboxEvent                                 │
   │            ┌──────▼───────┐ publish (confirms)  ┌────────────────┐       │
   │            │  Postgres    │ ◄── Outbox Relay ──►│   RabbitMQ     │       │
   │            └──────▲───────┘                     └───┬────────────┘       │
   │                   │ state + events                  │ consume (ack)      │
   │            ┌──────┴───────────────────────────────┐ │                    │
   └────────────┤  Worker (Nest, بدون HTTP)            │◄┘                    │
                │  ingest · transcribe · segment ·     │──────────────────────┘
                │  render · cleanup                    │   gRPC/HTTP أو queue
                └──────────┬───────────────────────────┘
                           │ analyze.requested / analyze.done
                    ┌──────▼───────┐
                    │ Analyzer (Py)│  face detection + speaker turns → ReframePlan
                    └──────────────┘
```

### 4.1 القرارات الأساسية (ليه)

| قرار                                                                           | السبب                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RabbitMQ** بدل BullMQ                                                        | طلبك. ويدي routing وDLX وquorum queues وack يدوي.                                                                                                                                                                |
| **API و Worker processes منفصلين** (نفس الـ codebase، `main.ts` و `worker.ts`) | الشغل التقيل ميأثرش على الـ API، وكل واحد يتـ scale لوحده.                                                                                                                                                       |
| **Object storage (S3 API) بدل Cloudinary**                                     | Cloudinary مش بيعمل face tracking ولا speaker switching، وترجمة الـ text layers هشة، وكل derived render بيتخزن ويتحاسب. الملف الأصلي عندنا = تحكم كامل في الحذف والتكلفة. Dev: MinIO. Prod: Cloudflare R2 أو S3. |
| **FFmpeg في الـ worker** للـ render                                            | pipeline واحد: crop + subtitles + audio، progress حقيقي، قابل للإلغاء.                                                                                                                                           |
| **Analyzer كـ service مستقل (Python)**                                         | face detection/diarization مكتباتها Python (OpenCV/MediaPipe/pyannote). يتكلم مع الـ worker بـ RabbitMQ برضه.                                                                                                    |
| **Postgres = source of truth للحالة**                                          | RabbitMQ بس ينقل "اشتغل على job X". الحالة الحقيقية في DB، فأي message بتتكرر ما تضرش.                                                                                                                           |
| Redis                                                                          | يتشال خالص: في الكود مستخدم للـ BullMQ بس (الـ throttler in-memory). ملحوظة: rate limiting على الـ auth per-instance؛ لو الـ API اتعمله scale لأكتر من instance يتحط throttler storage على Redis وقتها.          |

### 4.2 Pipeline والـ states

```
UPLOADING → UPLOADED → PROCESSING → READY            (أو FAILED / DELETING)
                           │
        INGEST → TRANSCRIBE → SEGMENT → ANALYZE   (كل stage = ProcessingJob)
```

- **INGEST**: ffprobe + validate، استخراج audio، poster، proxy 720p H.264 للمعاينة في المتصفح.
- **TRANSCRIBE**: chunks من الـ audio المخزن → Groq Whisper → `Transcript`/`TranscriptSegment` بـ words.
- **SEGMENT**: LLM يقسّم لـ clips (موجود حاليًا، يتحول لـ stage مستقل) → `Clip(status=DRAFT)`.
- **ANALYZE**: Analyzer: الوشوش + المتكلمين → `ReframePlan` للفيديو.
- لما الأربعة يخلصوا → `Video.status = READY`. اليوزر يراجع الـ clips ويعدل.
- **RENDER**: بالطلب بس (Export) لكل clip. مش تلقائي (بيوفر شغل وتكلفة).
- **CLEANUP**: الحذف وصيانة الملفات.

`ProcessingJob.status`: `QUEUED → RUNNING → COMPLETED` | `RETRYING` | `FAILED` | `CANCELLED`.

### 4.3 Transactional Outbox

أي إنشاء job بيحصل في **transaction واحدة**: `ProcessingJob` + `OutboxEvent`. Relay في الـ worker بيقرا `OutboxEvent` الـ pending ويعمل publish بـ **publisher confirms** وبعدين يعلّم `publishedAt`. كده مفيش job يتيم لو RabbitMQ وقع لحظتها. `idempotencyKey` unique (`{videoId}:{type}:{version}`) بيمنع التكرار.

### 4.4 RabbitMQ topology

```
Exchanges (durable, direct):  reels.work   reels.retry   reels.dlx

Per work queue Q ∈ { ingest, transcribe, segment, analyze, render, cleanup }:
  Q            quorum, durable
               x-dead-letter-exchange = reels.dlx
               x-dead-letter-routing-key = Q.dead
               x-delivery-limit = 5          (poison-message guard)
  Q.retry.10s  x-message-ttl=10000   DLX → reels.work (rk = Q)
  Q.retry.1m   x-message-ttl=60000   DLX → reels.work (rk = Q)
  Q.retry.5m   x-message-ttl=300000  DLX → reels.work (rk = Q)
  Q.dlq        (messages اللي خلصت retries — للمراجعة اليدوية والـ replay)
```

**Consumer rules:**

- `prefetch = 1` للـ render/ingest/transcribe (شغل تقيل)، manual `ack`، messages `persistent`.
- أول سطر في الـ handler: `UPDATE ProcessingJob SET status='RUNNING', lockedBy=?, heartbeatAt=now() WHERE id=? AND status IN ('QUEUED','RETRYING')`. لو 0 rows → `ack` وتخطي (duplicate/cancelled).
- نجاح → DB `COMPLETED` + outbox للـ stage اللي بعده → `ack`.
- فشل **retryable** وattempt < max → DB `RETRYING` + `publish` لـ `Q.retry.<tier>` (header `x-attempt`) → `ack` الأصلية.
- فشل **fatal** أو خلصت المحاولات → DB `FAILED` + `errorCode` + publish لـ `Q.dlq` → `ack`.
- Library: `amqplib` + `amqp-connection-manager` (reconnect تلقائي). Wrapper واحد `RabbitService` (publish + consume + topology assert عند الـ startup).

**Retry policy:**
| Queue | Max attempts | Backoff | ملاحظة |
|-------|--------------|---------|--------|
| ingest | 3 | 10s → 1m → 5m | |
| transcribe | 5 | 10s → 1m → 5m → 5m | 429 من Groq: استنى `Retry-After` (publish بـ `expiration`) |
| segment | 3 | 10s → 1m → 5m | JSON validation فاشل = retry بـ prompt مصحح (موجود) |
| analyze | 3 | 10s → 1m → 5m | |
| render | 3 | 10s → 1m → 5m | |
| cleanup | 10 | 1m → 5m (تكرار) | idempotent، ميفشلش المستخدم |

**Error taxonomy** (`AppJobError { code, retryable, userMessage }`):

- Retryable: network/timeout، 5xx، 429، storage 5xx، FFmpeg killed by OOM/signal.
- Fatal: ملف تالف/مش فيديو (`INVALID_MEDIA`)، مدة أكبر من الحد، مفيش audio track، الفيديو اتحذف، الـ job اتلغى، validation 4xx.
- `userMessage` بيتعرض في الـ UI بالعربي/إنجليزي (code → i18n key). ممنوع نسرّب stack/provider errors للمستخدم.

### 4.5 Lease + Heartbeat + Reaper

- الـ worker بيحدّث `heartbeatAt` كل 15 ثانية أثناء الشغل.
- Scheduled job (كل دقيقة، بـ Postgres advisory lock عشان instance واحدة بس): أي `RUNNING` و `heartbeatAt < now()-2m` → يرجع `RETRYING` (يعدّ كمحاولة) + outbox. دا بديل `recoverPersistedJobs`.
- RabbitMQ كمان بيعيد الـ message لو الـ consumer مات من غير ack (لأنها unacked) → والـ idempotent claim فوق يمنع التنفيذ المزدوج.

### 4.6 Cancel

`POST /jobs/:id/cancel` → DB `CANCELLED`. الـ worker بيشيك الـ flag بين الخطوات وفي progress callback بتاع FFmpeg، ولو cancelled: `ffmpeg.kill('SIGKILL')` + مسح temp + `ack`.

### 4.7 Data model (التغييرات)

```prisma
enum VideoStatus   { UPLOADING UPLOADED PROCESSING READY FAILED DELETING }
enum ContentType   { PODCAST SOLO }
enum JobType       { INGEST TRANSCRIBE SEGMENT ANALYZE RENDER CLEANUP }
enum JobStatus     { QUEUED RUNNING RETRYING COMPLETED FAILED CANCELLED }
enum AssetKind     { SOURCE AUDIO PROXY POSTER THUMB RENDER SUBTITLE_FILE }
enum ClipStatus    { DRAFT READY }

model Video {          // تعديل
  contentType ContentType @default(SOLO)
  deletedAt   DateTime?
  // cloudinaryId  ← يتشال، بدله MediaAsset(kind=SOURCE)
}

model ProcessingJob {  // تعديل
  type JobType; status JobStatus
  idempotencyKey String @unique
  attempt Int @default(0); maxAttempts Int
  lockedBy String?; heartbeatAt DateTime?
  errorCode String?; lastError String?
  // bullJobId ← يتشال
  events JobEvent[]
}
model JobEvent    { id, jobId, at, level, message, data Json? }       // timeline للـ debugging والـ UI
model OutboxEvent { id, routingKey, payload Json, createdAt, publishedAt? , attempts Int }
model MediaAsset  { id, userId, videoId?, clipId?, kind AssetKind, storageKey @unique,
                    sizeBytes BigInt?, contentType, status(PENDING|READY|DELETING|DELETED),
                    expiresAt DateTime?, createdAt }
model ReframePlan { id, videoId @unique, version, contentType, faces Json, speakerTurns Json?, createdAt }
model Clip        { // تعديل
  status ClipStatus @default(DRAFT); score Float?; reason String?
  // thumbnailUrl ← يتحول لـ MediaAsset(kind=THUMB)
}
model TranscriptSegment { speaker String? }                           // للـ diarization
model ClipRender  { assetId String?  /* MediaAsset(kind=RENDER) */ }
```

---

## 5. Reframing + Subtitles + Export (قلب المنتج)

### 5.1 Analyzer (Python service، stage `ANALYZE`)

Input: `{ videoId, proxyKey, audioKey, contentType, transcript speaker hints? }`. Output: `ReframePlan`.

1. Sample frames (2 fps من الـ proxy 720p) → face detection (YuNet/MediaPipe) → face tracks (IoU tracking) بـ bbox لكل ثانية.
2. **SOLO**: اختار الـ track الأكبر/الأكثر ظهورًا. لكل clip يتحسب **crop ثابت**: median لمركز الوش على مدة الـ clip → قص عرض `ih*9/16` متمركز عليه (clamped). **مفيش حركة كاميرا أبدًا** ("الكاميرا ثابتة مكانها").
3. **PODCAST**: لازم track لشخصين (لو لقى واحد أو تلاتة → warning وfallback). تحديد المتكلم النشط بـ diarization (pyannote أو whisperx) على الـ audio → `speakerTurns[{speaker,start,end}]` وربط كل speaker بـ face track (الوش اللي حركة فمه بتتطابق مع الكلام، أو يمين/شمال لو الكاميرا ثابتة).
4. **Switching rules** (عشان ميبقاش مزعج): أقل مدة لقطة 1.5 ث، تجاهل الـ turns أقل من 0.8 ث (backchannel زي "أيوه"), cut مباشر (hard cut) مش pan، ولو الاتنين بيتكلموا فوق بعض لأكتر من 2 ث → اللقطة تفضل على المتكلم الأقدم.
5. **Fallback آمن (V1 minimum)**: لو الـ diarization فشل أو ثقته واطية → layout **stacked** (الشخصين فوق بعض، كل واحد نص الشاشة 1080×960). دا مش بيحتاج speaker detection، فالـ pipeline عمره ما يفشل بسبب دا.
6. لو مفيش وشوش خالص → center crop.

> ⚠️ **Spike إلزامي (Task 4.1، مهلة 2–3 أيام):** جرّب 3–4 فيديوهات بودكاست حقيقية عربي. قيّم دقة الـ diarization والـ cut quality. لو مش كويس → V1 يطلع بـ stacked كـ default للـ PODCAST، والـ switching ينزل V1.1. دا أخطر جزء تقني في المشروع.

### 5.2 Render (Worker، FFmpeg، stage `RENDER`)

- Input: الـ source (مش الـ proxy) + clip range + `ReframePlan` + subtitles.
- **SOLO**: `-ss/-to` + `crop=ih*9/16:ih:{X}:0,scale=1080:1920`.
- **PODCAST switching**: segments حسب `speakerTurns` داخل الـ clip، كل segment `trim`+`crop` بـ X بتاعه، وبعدين `concat` في `filter_complex` واحد.
- **PODCAST stacked**: `[crop A][crop B] vstack`.
- Subtitles: ملف **ASS** بيتولد من `subtitle-cue-builder` الموجود + styles، ويتحرق بـ `ass=` filter مع `fontsdir=assets/fonts` (Cairo/Amiri الموجودين). libass+harfbuzz بيتعامل مع shaping العربي. اتأكد إن الـ FFmpeg build فيه `--enable-libass --enable-libharfbuzz`.
- Audio: `loudnorm` خفيف. Video: `libx264 -crf 20 -preset veryfast -pix_fmt yuv420p -movflags +faststart`.
- Progress حقيقي من `-progress pipe:1` → `updateProgress` (throttled كل ثانية).
- الإخراج → `MediaAsset(kind=RENDER, expiresAt = now + 14d)`.
- **Idempotent**: render key = hash(clipId, start, end, subtitleKey, planVersion). لو موجود READY → رجّعه من غير شغل.

### 5.3 Transcript & Subtitles generation

- Transcribe من الـ AUDIO المخزن (mono 16k)، chunks 10 دقايق بـ overlap 10 ث (الموجود)، **كل chunk checkpoint** (يتخزن نتيجته فورًا) والـ retry يكمل من أول chunk ناقص.
- Language: اختيار اليوزر (`ar` default) + خيار Auto (Whisper detect).
- Subtitles per clip بتتولد من الـ words (موجود) وتتعدل (موجود). V1 styles = 3 presets: **Clean** (نص أبيض + ظل)، **Box** (خلفية سودا شفافة)، **Highlight** (كلمة بكلمة بلون الـ accent).

### 5.4 Export

| Export     | الشكل                           | ملاحظة                                                      |
| ---------- | ------------------------------- | ----------------------------------------------------------- |
| Reel       | MP4 1080×1920 (أو 720×1280)     | بيعدي على `RENDER` queue، تحميل بـ presigned URL قصير العمر |
| Transcript | SRT / VTT / TXT                 | بيتولد on-the-fly من DB، بدون queue                         |
| Export all | يعمل render لكل الـ READY clips | UI يعرض progress لكل clip وروابط التحميل                    |

---

## 6. التخزين والحذف (الـ lifecycle الصح)

### 6.1 Keys

```
users/{userId}/videos/{videoId}/source.{ext}
users/{userId}/videos/{videoId}/audio.mp3
users/{userId}/videos/{videoId}/proxy-720p.mp4
users/{userId}/videos/{videoId}/poster.jpg
users/{userId}/videos/{videoId}/clips/{clipId}/thumb.jpg
users/{userId}/videos/{videoId}/clips/{clipId}/renders/{renderId}.mp4
```

كل ملف له row في `MediaAsset`. **مفيش ملف في storage من غير row.**

### 6.2 Upload (resumable)

1. `POST /videos` → Video(UPLOADING) + S3 `CreateMultipartUpload` → يرجع `uploadId` + presigned URL لكل part (parts 8–16MB).
2. المتصفح يرفع parts بالتوازي (3–4) مع retry لكل part. للـ resume: `GET /videos/:id/upload` يرجع الـ parts اللي اترفعت (`ListParts`).
3. `POST /videos/:id/complete` → `CompleteMultipartUpload` + `HEAD` للتأكد من الحجم → Video(UPLOADED) → outbox(`ingest`).
4. Bucket lifecycle rule: `AbortIncompleteMultipartUpload` بعد 2 يوم (حماية إضافية).

### 6.3 الحذف

```
DELETE /videos/:id
 1. tx: Video.status=DELETING, deletedAt=now(); cancel كل الـ jobs الشغالة (CANCELLED)
 2. tx: لكل MediaAsset للفيديو (وللـ clips) → status=DELETING
 3. outbox → cleanup queue { videoId }
 4. API يرجع 202 فورًا (الفيديو يختفي من الـ library)
CLEANUP worker (idempotent، retry 10 مرات):
 5. يمسح objects من S3 (batch DeleteObjects) — "not found" = نجاح
 6. يعلّم MediaAsset=DELETED
 7. لما كل الـ assets DELETED → hard delete Video (cascade: clips, transcript, jobs, renders)
```

نفس المنطق لـ: حذف clip (assets بتاعته: thumb + renders)، وحذف render قديم، وحذف الحساب.

### 6.4 Retention وصيانة (scheduled في الـ worker بـ advisory lock)

| Job                   | تكرار   | وظيفة                                                                            |
| --------------------- | ------- | -------------------------------------------------------------------------------- |
| purge-failed-uploads  | ساعة    | `UPLOADING` أقدم من 24 ساعة → Abort multipart + احذف الـ row                     |
| purge-expired-renders | ساعة    | `MediaAsset.expiresAt < now()` → احذف (اليوزر يقدر يعيد الـ export)              |
| purge-soft-deleted    | ساعة    | `DELETING` عالق أكتر من ساعة → أعد نشر cleanup                                   |
| orphan-sweep          | يوم     | قارن listing الـ bucket بـ `MediaAsset` → احذف اللي من غير row (أقدم من 24 ساعة) |
| reaper                | دقيقة   | jobs الـ `RUNNING` بدون heartbeat (4.5)                                          |
| temp-sweep            | startup | امسح `os.tmpdir()/reelcast/*` الأقدم من ساعتين                                   |

**Temp files rule:** كل job ياخد `workdir = tmp/reelcast/{jobId}`، ويتمسح في `finally` مهما حصل. حد أقصى للـ disk usage لكل worker.

---

## 7. التصميم (Design System — بسيط وحديث)

**الاتجاه:** dark، هادي، مساحات واسعة، لون accent واحد (الـ emerald الموجود أصلًا `#10B981` عشان نقلل الشغل)، مفيش gradients ولا glow. الـ focus على الفيديو.
**الخطوط:** Cairo (عربي + لاتيني) للـ UI، Amiri/Cairo للـ subtitles بس.
**RTL/LTR:** كل الـ spacing بـ logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`). ممنوع `ml-`/`mr-`/`left-`/`right-`.

### 7.1 Tokens (`app/globals.css` — مصدر الحقيقة الوحيد)

```css
@import "tailwindcss";

:root {
  color-scheme: dark;
  --bg: #0b0b0f; /* الصفحة */
  --surface: #121218; /* الكروت */
  --surface-2: #181820; /* hover / inputs / dialogs */
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.16);
  --text: #f4f4f6;
  --text-muted: #9a9aa8;
  --accent: #10b981;
  --accent-hover: #34d399;
  --accent-soft: rgba(16, 185, 129, 0.14);
  --on-accent: #052e1f;
  --danger: #f87171;
  --danger-soft: rgba(248, 113, 113, 0.14);
  --warning: #fbbf24;
  --warning-soft: rgba(251, 191, 36, 0.14);
  --info: #60a5fa;
  --info-soft: rgba(96, 165, 250, 0.14);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
}
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-text: var(--text);
  --color-muted: var(--text-muted);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-soft: var(--accent-soft);
  --color-on-accent: var(--on-accent);
  --color-danger: var(--danger);
  --color-warning: var(--warning);
  --color-info: var(--info);
}
```

الاستخدام: `bg-surface border border-border text-text text-muted bg-accent text-on-accent`.
**Guard (Task 6.1):** script في CI بيفشل لو لقى `#[0-9a-fA-F]{3,8}` أو `bg-white` أو `text-black` في `app/` أو `components/` (ما عدا `globals.css`).

### 7.2 Type & spacing

- Scale: 12 / 14 / 16 / 20 / 28 / 36. Body 14–16، weights 400/600/700 بس.
- Spacing على grid 4px. Card padding 16–20. Page max-width 1200، gutter 16/24.
- Motion: 150ms ease للـ hover/focus، 200ms للـ dialogs. احترام `prefers-reduced-motion` (موجود).

### 7.3 Primitives (`components/ui/`)

`Button` (primary / secondary / ghost / danger، sizes sm/md) · `Card` · `Input` / `Select` / `Switch` · `Badge` (status) · `Progress` · `Dialog` + `Drawer` · `Tabs` · `EmptyState` · `Skeleton` · `Toast` (موجودين في feedback، يتنقلوا ويتـ restyle).
مكتبة: ممكن Radix primitives (a11y جاهز: dialog/tabs/switch) + Tailwind. مفيش component library تقيلة.

### 7.4 الشاشات (V1 — خمس شاشات بس)

**Header (واحد لكل الصفحات):** Logo · [فاضي] · `AR | EN` · Usage chip (`12 / 60 دقيقة`) · Avatar menu (Sign out).

**1) Login / Register** — كارت واحد في النص، email + password، رابط للتانية. مفيش حاجة تانية.

**2) Library `/`**

```
┌ Header ─────────────────────────────────────────────┐
│ فيديوهاتي                              [ + ارفع فيديو ] │
│ [الكل] [قيد المعالجة] [جاهز]                         │
│ ┌─────┐ ┌─────┐ ┌─────┐                              │
│ │poster│ │poster│ │poster│   Video card: poster،      │
│ │ 58:20│ │ 12:04│ │ 41:10│   العنوان، Badge الحالة،   │
│ │Title │ │Title │ │Title │   عدد الـ clips، ⋯ menu    │
│ │●جاهز │ │◔ 62% │ │✕ فشل │   (Rename / Delete)       │
│ └─────┘ └─────┘ └─────┘                              │
└─────────────────────────────────────────────────────┘
```

Empty state: أيقونة + "ارفع أول بودكاست" + زرار. الفيديو الفاشل: Badge أحمر + زرار **Retry** + سبب بشري قصير.

**3) Upload `/videos/new`** — dropzone كبير. بعد اختيار الملف: العنوان، **Content type** (كارتين: 🎙 Podcast — شخصين / 👤 Solo — شخص واحد)، اللغة (Select)، Switch "اعمل clips تلقائي" (default on). زرار Upload + progress bar كبير + Pause/Resume + Cancel. بعد الرفع → redirect لصفحة الفيديو.

**4) Video / Project `/videos/[id]`**

```
┌ Header ──────────────────────────────────────────────┐
│ ← Title                                  [ ⋯ ]        │
│ Stepper: ✓ رفع ─ ✓ نسخ ─ ◔ تقسيم ─ ○ تحليل ─ ○ جاهز   │  ← بيتحدث لوحده
│  (فشل في خطوة؟ رسالة + Retry لنفس الخطوة بس)           │
├──────────────────────────────────────────────────────┤
│ Tabs:  [Clips (8)]   [Transcript]                     │
│ Clips: grid كروت 9:16                                 │
│  ┌──────┐  thumb، رقم، Title، المدة، Score            │
│  │ 9:16 │  Badge: Draft / Rendering 40% / Ready       │
│  └──────┘  [ تعديل ]  [ Export ]                      │
│ [ Export all ]                                        │
└──────────────────────────────────────────────────────┘
```

Transcript tab: نص مع timestamps، click يقفز للفيديو، زرار Export (SRT/VTT/TXT).

**5) Clip editor (Drawer)** — يمين/شمال حسب الاتجاه:

- Preview 9:16 (الـ proxy + crop من الـ ReframePlan بـ CSS transform، يعني من غير render).
- Trim: slider بـ handles + حقول mm:ss (بدل صفحة `trimmer` المنفصلة).
- Title، Switch **Subtitles**، اختيار الـ style (3 كروت صغيرة)، تعديل نص الترجمة (list).
- Layout (للـ podcast): Auto / Stacked.
- Footer: [ Save ] [ Export ← Dialog: الجودة 1080/720 → Start ].

### 7.5 الحالات (لازم كلها تتصمم)

Loading (skeleton) · Empty · Error (رسالة + إجراء) · Processing (progress) · Failed (سبب + Retry) · Offline/Session expired. كل رسالة error من `errorCode` → i18n.

---

