# ReelCast — Master Plan (Audit + Target Architecture + Tasks)

> الملف دا مرجع واحد للـ AI والـ developer. فيه: المنتج، الفلو الصح من أول الرفع لآخر الـ export، الأخطاء الحالية وحلها، الـ architecture الجديدة (RabbitMQ)، التصميم، وكل التاسكات (ADD / MODIFY / REMOVE) مترتبة.
>
> **حدود المراجعة:** المراجعة دي static (قراءة كود). مشغلتش الـ app ولا الـ tests ولا الـ migrations، فأي حاجة مكتوبة "Bug" مبنية على قراءة الكود وعليها مرجع (ملف). قبل ما تصلح أي bug، reproduce الأول لو سهل.

---

## 0. إزاي الـ AI يشتغل بالملف دا

1. اشتغل **task واحد في المرة** بالترتيب (Phase 0 → 7). كل task له `Depends on` و `Done when`.
2. متلمسش حاجة برا نطاق الـ task.
3. بعد كل task: `typecheck` + `lint:check` + `test` في الباك، و `typecheck` + `lint` + `test` في الفرونت. لازم تعدي.
4. كل business logic جديد ليه unit test (`be/test/unit/<module>/`). أي consumer جديد ليه integration test على RabbitMQ حقيقي (testcontainers أو docker-compose).
5. Conventions (من `docs/PROJECT.md` الحالي، وهتفضل):
   - الكود والـ identifiers والـ logs والـ errors والـ commits **English**.
   - نصوص الـ UI كلها من i18n (`ar` + `en`). ممنوع string hardcoded في component.
   - مفيش comments إلا للـ "why" الغريب.
   - TypeScript strict، مفيش `any`. DTO validation بـ class-validator. Controllers رفيعة، المنطق في services.
   - Conventional commits، branch لكل task: `feat/<task-id>-name`.
6. **ممنوع hex colors أو `bg-white` أو لون Tailwind مباشر في أي component.** ألوان من tokens بس (القسم 7).

---

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

## 8. التاسكات

**Legend:** `[ADD]` جديد · `[MOD]` تعديل · `[DEL]` حذف. حجم: S (≤½ يوم) · M (1–2 يوم) · L (3+ أيام). `→` = Depends on.

### Phase 0 — أمان وتنضيف (ابدأ بيه)

- **0.1 [DEL/MOD] الأسرار (S)** — شيل `be/.env` و `fe/.env.local` من الـ repo، `.gitignore`، أضف `be/.env.example` بكل المتغيرات. **اعمل rotate للـ Groq key والـ Cloudinary secret والـ JWT secret.** Done when: مفيش secrets في الـ working tree ولا الـ git history (`git filter-repo` لو اتعمل commit قبل كده).
- **0.2 [DEL] ملفات مش مكانها (S)** — شيل `.agents/`، `.husky/_/`، `fe/tsconfig.tsbuildinfo`، و`be/src/generated/` من الـ git (generated عند الـ build)، وضيفهم لـ `.gitignore`. Done when: `npm run build` بيولّد Prisma client من نضيف.
- **0.3 [MOD] docs (S)** — انسخ الأقسام 1–7 من الملف دا لـ `docs/PROJECT.md` (استبدال)، واحذف `REFRAMING_STRATEGY.md` وحط `docs/REFRAMING.md` بالقسم 5.1. حدّث README الباك والفرونت.
- **0.4 [DEL] Local storage fallback (M) → 2.1** — شيل `ENABLE_LOCAL_STORAGE_FALLBACK` و `LOCAL_STORAGE_DIR`، endpoints الـ stream/local chunk/render file، `probeLocalVideo`، `ensureLocalThumbnail`…، وفروع `isLocalStorage` كلها. Done when: `grep -ri "local:" be/src` فاضي.

### Phase 1 — RabbitMQ + Worker + Schema

- **1.1 [ADD] Infra (S)** — `docker-compose.yml`: `rabbitmq:3.13-management` (volume + healthcheck)، `minio` + bucket init، `worker`، `analyzer`. شيل `redis` من الـ queue (اتركه لو الـ throttler محتاجه). Env جديدة (القسم 9).
- **1.2 [MOD] Prisma schema + migration (M)** — القسم 4.7: enums، `ProcessingJob` (rename/add)، `JobEvent`، `OutboxEvent`، `MediaAsset`، `ReframePlan`، تعديل `Video/Clip/TranscriptSegment/ClipRender`. Migration بتنقل الداتا الموجودة (`TRANSCRIPTION→TRANSCRIBE`، `PENDING→QUEUED`، `FAILED+'Stopped by the user'→CANCELLED`). Done when: `prisma migrate deploy` على DB فاضية وعلى DB فيها داتا الاتنين بينجحوا.
- **1.3 [ADD] `RabbitModule` + `worker.ts` (M) → 1.1** — `RabbitService` (connection manager، publisher confirms، topology assert القسم 4.4، `consume(queue, handler, {prefetch})`). `src/worker.ts` بيـ bootstrap `WorkerModule` بدون HTTP. Scripts: `start:worker`، `start:worker:dev`. Done when: API وworker يشتغلوا كـ processes منفصلة وrestart للـ broker مش بيوقعهم.
- **1.4 [ADD] Outbox (M) → 1.2, 1.3** — `JobsService.enqueue(tx, {type, videoId, payload})` بتكتب `ProcessingJob` + `OutboxEvent` في نفس الـ tx مع `idempotencyKey` unique. `OutboxRelay` في الـ worker (poll كل 1s بـ `FOR UPDATE SKIP LOCKED`) يعمل publish ويعلّم `publishedAt`. Done when: لو RabbitMQ واقع وقت الـ create، الـ job بيتنشر بعد رجوعه. اختبار: kill broker → create → start broker.
- **1.5 [ADD] Job runner framework (L) → 1.3, 1.4** — `BaseJobConsumer`: claim idempotent، heartbeat، error taxonomy (`AppJobError`)، retry routing (4.4)، DLQ، `JobEvent` logging، cancel flag check، `finally` cleanup للـ workdir. + Reaper (4.5) + Postgres advisory lock helper. Done when: integration tests: (a) retryable error يعدي بالـ tiers ويخلص لـ DLQ بعد max، (b) message متكررة تتنفذ مرة، (c) kill -9 للـ worker وسط job يتـ recover، (d) cancel يوقف job شغال.
- **1.6 [MOD] Jobs API (S) → 1.5** — `GET /videos/:id/jobs`، `POST /jobs/:id/retry` (من FAILED فقط، ينشر نفس الـ stage)، `POST /jobs/:id/cancel`. رجّع `errorCode` بدل نص خام. شيل `stopJob` القديم.
- **1.7 [DEL] BullMQ (S) → 3.x, 5.x تخلص** — شيل `bullmq`, `@nestjs/bullmq`, `ioredis` (لو مش مستخدم)، `bull-processing-queue`, `in-memory-processing-queue`, `processing-bull.register`, `ProcessingProcessor`, `ProcessingStartupService`. في الـ tests استبدل in-memory queue بـ fake `RabbitService`.

### Phase 2 — Storage, Upload, Lifecycle

- **2.1 [ADD] `StorageService` على S3 (M) → 1.1** — interface: `createMultipart`, `presignPart`, `listParts`, `completeMultipart`, `abortMultipart`, `head`, `presignGet(key, ttl)`, `putObject`, `getObjectStream`, `deleteObjects(keys[])`, `list(prefix)`. `@aws-sdk/client-s3` + `s3-request-presigner`. (MinIO في dev، R2/S3 في prod بنفس الكود.)
- **2.2 [ADD] `MediaAssetService` (S) → 1.2, 2.1** — `register`, `markReady`, `markDeleting`, `signedUrl`. أي كتابة في storage بتعدي منه.
- **2.3 [MOD] Upload endpoints + frontend client (M) → 2.1** — `POST /videos` (title, contentType, language, autoClips)، `GET /videos/:id/upload`، `POST /videos/:id/upload/parts` (presign batch)، `POST /videos/:id/complete`. Frontend: أعد كتابة `lib/chunked-upload.ts` (parts متوازية، retry لكل part بـ exponential backoff، resume من `ListParts`، pause/cancel).
- **2.4 [MOD] Validation (S)** — الصيغ (mp4/mov/webm/mkv)، الحجم، المدة (من ffprobe في INGEST، مش من المستخدم)، فيديو بدون audio = فشل `NO_AUDIO_TRACK`.
- **2.5 [ADD] Delete flow (M) → 1.5, 2.2** — القسم 6.3 للـ video وللـ clip، مع `CLEANUP` consumer. Done when: حذف فيديو فيه transcript + 5 clips + 3 renders ومعاه job شغال = bucket فاضي لمسار الفيديو، DB فاضي، الـ job اتلغى، مفيش temp files.
- **2.6 [ADD] Scheduled maintenance (M) → 1.5, 2.5** — القسم 6.4 كله (بـ advisory lock). شيل `StaleUploadCleanupService`.

### Phase 3 — Pipeline stages

- **3.1 [ADD] INGEST consumer (M) → 1.5, 2.2** — ffprobe (duration, streams, codec)، تحديث Video، استخراج audio (mono 16k mp3) → MediaAsset، poster، proxy 720p H.264 (`-preset veryfast`، `+faststart`). outbox → `transcribe`. Status: `UPLOADED → PROCESSING`.
- **3.2 [MOD] Temp-file hygiene (S) → 1.5** — `workdir` لكل job، `finally`، حد لحجم الـ disk. (يغطي B5.)
- **3.3 [MOD] TRANSCRIBE consumer (M) → 3.1** — اقرا الـ audio من storage، chunks بـ overlap (موجود)، **checkpoint لكل chunk** (جدول `TranscriptChunk` أو MediaAsset JSON)، retry يكمل الناقص، تصنيف errors من status code (429 + `Retry-After`، 5xx، 4xx fatal)، chunks بالتوازي (concurrency 2، مضبوط بـ env). outbox → `segment`.
- **3.4 [MOD] SEGMENT consumer (M) → 3.3** — لف `AiClipRunsService`/`TopicSegmentationService` في consumer. `reserveAiRun` يتحول لـ reserve + `commit` عند النجاح و`release` عند الفشل النهائي. ينتج `Clip(status=DRAFT, source=AI, score, reason)`. لو `autoClips=false` يتخطى. شيل `runAutoClips` من الـ processor. تحديث default المدة: `AI_CLIP_MIN_DURATION_SEC=20`, `MAX=90`.
- **3.5 [MOD] Video status aggregation (S) → 3.1–4.4** — `Video.status=READY` لما INGEST+TRANSCRIBE+SEGMENT+ANALYZE كلهم COMPLETED/SKIPPED. أي stage FAILED نهائي → `Video.status=FAILED` مع `failedStage`. الـ endpoint `GET /videos/:id` بيرجع `pipeline: [{stage,status,progress,errorCode}]` للـ stepper.

### Phase 4 — Analyzer

- **4.1 [ADD] Spike: speaker/face (M)** — القسم 5.1 (تحذير). Output: تقرير قصير + قرار: switching في V1 ولا stacked default.
- **4.2 [ADD] `analyzer/` service (L) → 4.1, 1.3** — Python، consumer لـ `analyze`، بيقرا proxy+audio من S3، يكتب `ReframePlan` (عن طريق queue رد `analyze.done` أو HTTP callback موقّع)، Dockerfile، health. Done when: على فيديو solo يرجّع crop ثابت، وعلى podcast يرجّع speakerTurns أو stacked fallback.
- **4.3 [ADD] ANALYZE consumer في الـ worker (M) → 4.2** — يبعت request للـ analyzer ويستنى النتيجة (timeout + retry)، يخزن `ReframePlan`، يحدّث `TranscriptSegment.speaker` لو متاح.
- **4.4 [ADD] Reframe plan API (S) → 4.3** — `GET /videos/:id/reframe` (للـ preview في الـ editor)، `PATCH /clips/:id` يقبل `layout: AUTO|STACKED`.

### Phase 5 — Render, Subtitles, Export

- **5.1 [ADD] ASS builder (M)** — `subtitles/ass-builder.ts` من `subtitle-cue-builder` + `subtitle-style` (3 presets). Unit tests بنصوص عربي (RTL، تشكيل، أرقام).
- **5.2 [ADD] FFmpeg render pipeline (L) → 4.3, 5.1, 2.2** — القسم 5.2: solo/switching/stacked، subtitles، audio، progress، kill عند cancel، workdir. **Test بـ ffmpeg حقيقي** على فيديو sample صغير (CI).
- **5.3 [ADD] RENDER consumer (M) → 5.2, 1.5** — idempotent render key، يكتب `MediaAsset(RENDER, expiresAt)`، يحدّث `ClipRender`. Retry/DLQ حسب 4.4.
- **5.4 [MOD] Render/Export API (M) → 5.3** — `POST /clips/:id/renders` (quality, subtitles on/off + style)، `POST /videos/:id/renders` (all)، `GET /renders/:id/download` (presigned GET قصير). شيل `?reframe=true` URLs وكل endpoint بيرجع Cloudinary URL.
- **5.5 [ADD] Thumbnails (S) → 3.1** — thumb لكل clip عند إنشائه من الـ proxy (`-ss startSec`) كـ MediaAsset؛ job خفيف `THUMB` أو جوه SEGMENT.
- **5.6 [MOD] Transcript export (S)** — `GET /videos/:id/transcript.{srt|vtt|txt}`.
- **5.7 [DEL] Cloudinary (M) → 2.x, 5.x** — شيل `cloudinary`، `storage.service.ts` القديم، `subtitle-overlay.ts`، `SUBTITLE_BURN_MODE/BOX_MODE`، `clip-render-executor.service.ts`، env vars، migration لشيل `cloudinaryId`. (لو في داتا قديمة: script ينقل أو يتجاهل، قرار المنتج.)

### Phase 6 — Frontend

- **6.1 [MOD] Tokens + guard (S)** — القسم 7.1 في `globals.css`، script `scripts/check-colors.mjs` في CI، توحيد اسم البراند (`ReelCast`)، metadata، لوجو (recolor لو لازم).
- **6.2 [ADD] UI primitives (M) → 6.1** — القسم 7.3 في `components/ui/` + stories صغيرة/صفحة `/dev/ui` (dev فقط).
- **6.3 [MOD] Layout + Header + Library (M) → 6.2** — Header واحد، Library grid، video card جديد، filters، empty/error/skeleton. شيل `app-footer` لو مش لازم.
- **6.4 [MOD] Upload page (M) → 6.2, 2.3** — القسم 7.4 (3).
- **6.5 [MOD] Video page — تقسيم + إعادة بناء (L) → 6.2, 3.5** — قسّم `app/videos/[id]/page.tsx` لـ: `PipelineStepper`, `ClipsGrid`, `ClipCard`, `TranscriptPanel`, `ClipEditorDrawer`, `ExportDialog`، وhooks: `useVideo`, `useJobPolling` (backoff، توقف لما التاب hidden)، `useClipEditor`. كل ملف ≤ 250 سطر. (يغطي F2, F4.)
- **6.6 [MOD] Clip editor (L) → 6.5, 4.4** — القسم 7.4 (5)، preview بـ crop من الـ ReframePlan.
- **6.7 [MOD] Auth pages (S) → 6.2** — restyle (`auth-form.tsx` 427 سطر → أبسط).
- **6.8 [MOD] i18n (S) → 6.3–6.7** — كل strings (بما فيها error codes) في `ar.ts`/`en.ts`، واختبار إن المفاتيح متطابقة في اللغتين.
- **6.9 [DEL] القديم (S) → 6.3–6.7** — شيل: `trim-panel` + `/videos/[id]/trimmer`، `subtitle-style-panel`/`dialog` القديمين، `download-dialog`، `export-subtitles-button`، `clip-render-controls`، `burn-in.ts`/`use-burn-in.ts`، `clip-render.ts`، `video-preview.ts` (الجزء الخاص بـ Cloudinary)، `ai-clips-progress/dialog` (بيتحل بالـ stepper)، وأي test بتاعهم. `grep -rE "bg-white|#[0-9a-f]{6}" app components` فاضي.

### Phase 7 — جودة

- **7.1 [ADD] Integration tests (M)** — Postgres + RabbitMQ + MinIO بـ docker-compose في CI: الفلو الكامل بفيديو صغير (upload → ready → export → delete → bucket فاضي).
- **7.2 [ADD] Observability (S)** — logs بـ `jobId/videoId/stage` (JSON)، endpoint `/health` يفحص DB+RabbitMQ+S3، `/admin/queues` (أو RabbitMQ management) لمراقبة الـ DLQ، alert لو الـ DLQ مش فاضي.
- **7.3 [MOD] CI (S)** — `lint`, `typecheck`, `test`, color guard، build للـ analyzer image.
- **7.4 [ADD] Limits (S)** — حد أقصى للفيديوهات المتزامنة لكل مستخدم، حد للـ renders المتزامنة، quota للـ storage (من `MediaAsset.sizeBytes`).
- **7.5 [MOD] Docs نهائي (S)** — README تشغيل (docker-compose up)، `docs/RUNBOOK.md` (إزاي تعمل replay للـ DLQ، تفضي queue، تشوف job عالق).

### ترتيب التنفيذ المقترح

```
P0 → P1 (1.1→1.7*) → P2 (2.1–2.3) → P3 (3.1–3.4) ┐
                                                  ├→ P4 (4.1 spike بالتوازي مع P2/P3) → 4.2–4.4 → P5 → P6 → P7
                              P6.1–6.2 تقدر تبدأ بالتوازي من بعد P0 ┘
* 1.7 (حذف Bull) في الآخر بعد ما كل الـ stages تتنقل.
```

**Milestones:** M1 (P0–P3): فيديو يترفع ويتنسخ ويتقسم لـ clips بثبات وretry. M2 (P4–P5): reframing + subtitles + export. M3 (P6–P7): UI الجديد، حذف كامل، جاهز للـ beta.

---

## 9. Environment variables

**جديد:** `RABBITMQ_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (MinIO), `ANALYZER_TIMEOUT_MS`, `WORKER_CONCURRENCY_RENDER` (default 1), `WORKER_CONCURRENCY_TRANSCRIBE` (default 2), `RENDER_RETENTION_DAYS` (default 14), `DOWNLOAD_URL_TTL_SEC` (default 300), `WORKDIR_ROOT`.
**يتشال:** `CLOUDINARY_*`, `ENABLE_LOCAL_STORAGE_FALLBACK`, `LOCAL_STORAGE_DIR`, `SUBTITLE_BURN_MODE`, `SUBTITLE_BOX_MODE`, `RENDER_POLL_INTERVAL_MS`, `RENDER_TIMEOUT_MS`, `STALE_UPLOAD_*` (يتنقل لـ scheduler config)، و`REDIS_URL` (لو Redis اتشال).
**يتعدل:** `AI_CLIP_MIN_DURATION_SEC=20`, `AI_CLIP_MAX_DURATION_SEC=90`.

---

## 10. Definition of Done (لكل task)

- [ ] Done-when بتاع الـ task متحقق.
- [ ] `typecheck` + `lint` + `test` أخضر (باك وفرونت).
- [ ] اختبارات للـ logic الجديد؛ للـ consumers: happy path + retryable + fatal + duplicate message + cancel.
- [ ] مفيش secrets، مفيش hex colors، مفيش string UI hardcoded، مفيش `any`.
- [ ] لو الـ behavior أو الـ setup اتغير → الـ docs اتحدثت.
- [ ] مفيش ملفات temp أو objects يتيمة بعد الـ flow (اتشيّك يدويًا مرة على الأقل).

## 11. مخاطر وقرارات مفتوحة

| #   | الخطر/القرار                                | التوصية                                                                             |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | دقة تحديد المتكلم في البودكاست العربي (4.1) | Spike الأول. Fallback = stacked، المنتج مش بيتأجل.                                  |
| 2   | تكلفة compute للـ render والـ analyzer      | worker بـ concurrency 1 للـ render، autoscale حسب طول الـ queue. GPU مش لازم في V1. |
| 3   | الداتا القديمة على Cloudinary               | قرار منتج: ننقلها (script) أو نبدأ نضيف لأنه لسه pre-launch.                        |
| 4   | R2 vs S3                                    | R2 أرخص (من غير egress). الكود واحد بسبب S3 API.                                    |
| 5   | حقوق/خصوصية الفيديوهات                      | presigned URLs قصيرة العمر، مفيش public bucket، سياسة retention معلنة.              |
| 6   | الدفع والاشتراكات                           | خارج V1. الـ `UsageRecord` الموجود يكفي للـ limits.                                 |
