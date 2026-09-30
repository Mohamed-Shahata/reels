# Task 7.1 — Reframing Strategy Decision

## Decision

**Strategy: center crop with face gravity via Cloudinary URL transformation.**

No FFmpeg worker is needed. A reframed clip is produced by a single Cloudinary delivery URL that crops and delivers the clip at the same time the user requests it.

## Tested on

Real uploaded MP4 (`1280×720`, podcast-style, two speakers).

| Check | Result |
|-------|--------|
| `c_fill,ar_9:16,g_auto:faces` playback URL | Passed — returned `206 video/mp4`, face-gravity crop centred on the visible speaker |
| Same transformation + `fl_streaming_attachment` download URL | Passed — file downloaded correctly |
| Derived clip generated in approx 8 s on first request; cached on subsequent requests | Passed |

## Approach

Cloudinary supports stacking transformations. A reframed, time-trimmed clip is produced by:

```
so_<startSec>,eo_<endSec>/c_fill,ar_9:16,g_auto:faces
```

- `so_` / `eo_` — start and end offset trim
- `c_fill` — fill mode (no letterbox)
- `ar_9:16` — output aspect ratio for vertical reels
- `g_auto:faces` — gravity that follows detected faces; falls back to center if no faces are found

## Alternatives considered

| Strategy | Verdict |
|----------|---------|
| Center crop (`g_center`) | Simpler but misses off-center speakers |
| Split screen (speaker above speaker) | Requires knowing speaker positions — needs face detection coordinates not available at this tier |
| Active speaker tracking | Requires a dedicated ML pipeline — planned for Task 7.5, after 7.2–7.4 are stable |

## Outcome

`StorageService.getClipPlaybackUrl()` and `StorageService.getClipDownloadUrl()` build the delivery URL when called with `{ reframe: true }` (Task 7.2), adding `w_1080` so the output is 1080x1920. The clip endpoints expose this as `?reframe=true`. Cloudinary does the rendering, so no FFmpeg worker is needed. Task 7.3 adds a queued `RENDER` job only to track status, retry and store the output URL of a pre-generated reel. Plain `?reframe=true` URLs still work on demand and are cached by Cloudinary's CDN after the first hit.
