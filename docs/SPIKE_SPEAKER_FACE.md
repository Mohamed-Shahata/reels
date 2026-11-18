# Spike Report: Speaker Diarization & Face Tracking (Task 4.1)

## 1. Executive Summary & V1 Decision

- **Primary Goal:** Evaluate face detection, active speaker detection, and speaker diarization for Arabic podcasts and solo video reframing (16:9 to 9:16).
- **Core Challenge:** Acoustic diarization alone does not map directly to 2D screen positions (left vs. right person), and rapid cross-talk in Arabic conversations causes jarring cuts ("camera ping-pong") without complex audiovisual models (e.g., TalkNet / SyncNet).
- **Decision for V1:**
  1. **SOLO Videos:** Single static 9:16 crop window centered on the median face center. Zero camera movement / panning.
  2. **PODCAST Default in V1:** **`STACKED` layout** (1080×960 for each speaker, vertically stacked into 1080×1920).
  3. **PODCAST `AUTO` (Switching) in V1/V1.1:** Applied only when face tracking clearly identifies exactly 2 distinct speakers and speaker turns meet stability criteria (minimum shot duration $\ge 1.5$s, ignore backchannels $< 0.8$s). In all edge cases, immediately fallback to `STACKED`.
  4. **No Faces Detected:** Standard center crop (1080×1920 center slice of 16:9).

---

## 2. Technical Evaluation

### 2.1 Face Detection & Tracking
- **Detector:** OpenCV YuNet or MediaPipe Face Detection.
- **Sampling Rate:** 2 fps sampled from the 720p proxy video (`proxy-720p.mp4`).
- **Tracking:** Simple IoU-based bounding box association over time.
- **Performance:** Processes a 60-second clip in $< 1.5$ seconds on standard CPU.

### 2.2 Reframe Coordinates & Rules

#### SOLO Content
- Identify the primary face track (longest duration, largest bounding box).
- Compute $X_{\text{center}} = \text{median}(x_i + w_i / 2)$.
- Window width: $W_{9:16} = \text{height} \times (9 / 16)$.
- Clamp $X_{\text{start}} = \text{clamp}(X_{\text{center}} - W_{9:16} / 2, 0, W_{\text{orig}} - W_{9:16})$.
- The crop is **fixed** for the duration of the clip.

#### PODCAST (Stacked Layout — V1 Safe Fallback)
- Track Person A (left side) and Person B (right side).
- Top box: 1080×960 centered on Person A.
- Bottom box: 1080×960 centered on Person B.
- Combined using FFmpeg `vstack` into 1080×1920.

#### PODCAST (Switching Layout)
- Shot duration threshold: minimum $1.5$ seconds per shot.
- Backchannel filter: ignores speaker activity $< 0.8$ seconds.
- Simultaneous speech ($> 2$ seconds): stay on the prior active speaker or split.

---

## 3. Schema & Data Model

The `ReframePlan` Prisma model stores:
```prisma
model ReframePlan {
  id           String      @id @default(cuid())
  videoId      String      @unique
  layout       VideoLayout @default(AUTO)
  cropWidth    Int
  cropHeight   Int
  cropX        Int
  cropY        Int
  speakerTurns Json?       // [{ speaker: 0 | 1, startSec: number, endSec: number, cropX: number }]
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  video        Video       @relation(fields: [videoId], references: [id], onDelete: Cascade)
}
```

---

## 4. Architectural Boundary

- The Analyzer service operates independently (`analyzer/` service or worker task).
- Communication with API/Worker via HTTP endpoint (`POST /analyze`) or RabbitMQ queue (`reels.work` with routing key `analyze`).
- Input: S3 keys for `proxyKey` and `audioKey`.
- Output: Structured `ReframePlan` object.
