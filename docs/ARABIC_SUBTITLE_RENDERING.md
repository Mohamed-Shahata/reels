# Task 8.2 — Arabic and RTL Subtitle Rendering Spike

## Overview

Task 8.2 evaluates font support, letter joining (cursive Arabic shaping), right-to-left (RTL) text direction, bidirectional (BiDi) mixed text handling, and subtitle timing on real 9:16 vertical video renders before building subtitle presets (8.3) and burning options (8.4).

## Evaluation Matrix

Tested against a real uploaded podcast MP4 (`1280x720`, two speakers) in the project's Cloudinary environment.

| Test Item                    | Specification / Sample                               | Result                                                                         | Verdict                                         |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| **Font: Cairo**              | Google Font `Cairo`, 34pt, bold                      | Status 200, clean modern sans-serif aesthetic, crisp outline and high contrast | **Recommended** (Primary preset font for reels) |
| **Font: Amiri**              | Google Font `Amiri`, 36pt, bold                      | Status 200, traditional Naskh style, clear glyph distinctions                  | **Supported** (Secondary/classical preset font) |
| **Font: Arial**              | System font `Arial`, 40pt, bold                      | Status 200, clean rendering, neutral appearance                                | **Supported** (Fallback preset font)            |
| **Font: Tahoma**             | `Tahoma`, 40pt, bold                                 | Status 400                                                                     | **Unsupported** on Cloudinary server            |
| **Letter Joining (Shaping)** | Cursive ligatures (initial, medial, final glyphs)    | Full contextual glyph joining confirmed; zero isolated/broken letters          | **Passed**                                      |
| **RTL Direction**            | Reading order from right to left                     | Correct right-to-left word progression                                         | **Passed**                                      |
| **BiDi Mixed Text**          | Arabic mixed with numbers and Latin acronyms         | Numbers and English terms preserve correct inline direction                    | **Passed**                                      |
| **Punctuation Alignment**    | Arabic question marks and exclamation marks          | Punctuation correctly attaches to the clause end (left side)                   | **Passed**                                      |
| **Timed Overlays on Video**  | Sequential cues with `start_offset` and `end_offset` | Seamless cue transitions at exact timestamps in a 9:16 vertical MP4            | **Passed**                                      |

## Transformation Syntax

Cloudinary text overlay layers support per-layer time offsets (`so_<start>`, `eo_<end>`) chained directly on top of the vertical 9:16 reframing transformation:

```
so_<clipStart>,eo_<clipEnd>/ar_9:16,c_fill,w_720/b_rgb:000000a0,co_white,eo_<cue1End>,g_south,l_text:Cairo_34_bold:<encodedCue1Text>,so_<cue1Start>,y_120/b_rgb:000000a0,co_yellow,eo_<cue2End>,g_south,l_text:Cairo_34_bold:<encodedCue2Text>,so_<cue2Start>,y_120/...
```

Key transformation properties:

- `l_text:<font>_<size>_<weight>:<encodedText>`: Text layer with specified font family, size and weight.
- `b_rgb:000000a0`: Semi-transparent dark background box for subtitle readability over arbitrary video backgrounds.
- `co_white` / `co_yellow`: Subtitle text color.
- `g_south,y_120`: Anchored to bottom center with safe margin above platform UI controls (TikTok / Instagram Reel action icons).
- `so_<sec>,eo_<sec>`: Relative time offset inside the clip range determining when each cue appears and disappears.

## Architecture Decision for Task 8.3 & 8.4

1. **Preset Fonts**: Use `Cairo` (modern reel style), `Amiri` (classical style), and `Arial` (clean neutral style).
2. **Execution Engine**: Re-use Cloudinary's native video overlay pipeline via `StorageService` and `ClipRenderExecutorService`. No external FFmpeg worker is needed for standard burning.
3. **Delivery**: Can be delivered on-demand via URL transformations or pre-generated via eager render through the BullMQ `RENDER` job pipeline.

## Fix — cues shown for the whole clip

Cue timing (`start_offset` / `end_offset`) must be set on the `fl_layer_apply` component, not on the component that opens the text layer. Offsets on the opening component are ignored for text layers, so every cue was drawn for the entire clip and the subtitle looked frozen. `buildSubtitleOverlay` now puts the offsets on the placement component:

```
.../l_text:Cairo_34_bold:<text>,.../fl_layer_apply,g_south,y_120,so_<start>,eo_<end>
```

The subtitle position (Top / Middle / Bottom) is chosen in the Subtitle style panel and maps to Cloudinary gravity `north` / `center` / `south`.

## Note: subtitle files are not used

An overlay built from an uploaded SRT file (`l_subtitles`) was tested after this spike. It broke Arabic words into disconnected letters and offers no control over alignment or box width, so subtitles stay as text layers. Long clips are handled with a named transformation (see Task 8.4 in `PROJECT.md`).
