import type { SubtitleCue } from './subtitle-cue-builder';
import {
  type SubtitlePosition,
  type SubtitleStyle,
  SUBTITLE_REFERENCE_WIDTH_PX,
} from './subtitle-style';

export interface SubtitleBurnIn {
  style: SubtitleStyle;
  cues: SubtitleCue[];
}

export type OverlayComponent = Record<string, unknown>;

/**
 * How the subtitle box gets its opacity.
 * - ALPHA: one layer per cue, the opacity is the alpha of the box colour.
 *   The lightest URL, but Cloudinary can ignore the alpha (solid box).
 * - LAYERED: two layers per cue (box with a layer opacity, then the text).
 *   Honours the opacity, but doubles the number of layers in the reel.
 */
export type SubtitleBoxMode = 'ALPHA' | 'LAYERED';
export const DEFAULT_SUBTITLE_BOX_MODE: SubtitleBoxMode = 'ALPHA';

// Distance kept between the text and the frame edge, measured on the 720 px
// reference frame. It matches the margin verified in the Arabic rendering spike
// so the text stays clear of the platform buttons on TikTok and Instagram.
const EDGE_MARGIN_REFERENCE_PX = 120;
const TEXT_WIDTH_RATIO = 0.9;

// Cloudinary draws an SRT subtitles layer about 3.5x larger than the same
// font_size on a plain text layer (measured on rendered reels: a 40 px style
// came out near 150 px on the 1080 px frame). The factor brings the burned-in
// size back to what the preview shows. If rendered subtitles still look too
// big or too small, change only this number.
export const SUBTITLE_FILE_FONT_SCALE = 0.3;

const GRAVITY_BY_POSITION: Record<SubtitlePosition, string> = {
  TOP: 'north',
  MIDDLE: 'center',
  BOTTOM: 'south',
};

const CONTROL_CHARACTERS = /\p{Cc}/gu;

// Cloudinary's subtitles layer sizes the text box from its own measurement of
// the line. For Arabic (joined letters, hamza and tanween marks) that
// measurement can come out narrower than the glyphs actually drawn, so the
// first or last letters of a word were cut off at the edge of the box, most
// visibly on one-word cues. Non-breaking spaces on both sides of every cue
// widen the measured line, so any clipping lands on blank padding instead of
// on a letter. Regular spaces would be trimmed; NBSP is kept, and it exists in
// Cairo, Amiri and Arial. If words are still cut, raise this number.
export const SUBTITLE_FILE_PADDING_CHARS = 2;
const SUBTITLE_FILE_PADDING = '\u00a0'.repeat(SUBTITLE_FILE_PADDING_CHARS);

// Side padding of the box in LAYERS mode. A Cloudinary text layer draws its
// background exactly around the glyphs, with no inner margin, so the word
// touched the edge of the box while the preview (which has CSS padding) showed
// room on the left and right. Non-breaking spaces on both sides of the text
// give the same breathing room; they are kept by Cloudinary, unlike normal
// spaces. Raise the number for a wider box, lower it for a tighter one.
export const SUBTITLE_BOX_PADDING_CHARS = 2;
const SUBTITLE_BOX_PADDING = '\u00a0'.repeat(SUBTITLE_BOX_PADDING_CHARS);

// Corner radius of the subtitle box on the 720 px reference frame. Scaled with
// the frame like the font size, so the curve looks the same in the preview.
export const SUBTITLE_BOX_RADIUS_REFERENCE_PX = 14;

export function normalizeCueText(text: string): string {
  return text.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
}

function roundSeconds(value: number): number {
  return Math.round(value * 100) / 100;
}

function toBackgroundColor(hexColor: string, opacity: number): string | null {
  if (opacity <= 0) return null;
  const alpha = Math.round(Math.min(1, opacity) * 255)
    .toString(16)
    .padStart(2, '0');
  return `rgb:${hexColor.replace('#', '')}${alpha}`;
}

/**
 * One cue as Cloudinary components, in pairs of [layer, placement].
 *
 * In LAYERED mode, with a background, the cue is drawn as two stacked layers:
 *  1. the box: the same text in the box colour on a solid box of that colour
 *     (so only the rounded rectangle is visible), applied with the opacity the
 *     user chose;
 *  2. the text on top, fully opaque, with no background.
 * Putting the opacity on the layer itself is reliable. The alpha channel inside
 * `b_rgb:RRGGBBAA` was ignored once the layer also had a width and a radius,
 * which made the burned-in box fully solid while the preview showed it light.
 */
function buildCueLayer(
  cue: SubtitleCue,
  style: SubtitleStyle,
  frameWidthPx: number,
  boxMode: SubtitleBoxMode,
): OverlayComponent[] | null {
  const text = normalizeCueText(cue.text);
  const startSec = roundSeconds(cue.startSec);
  const endSec = roundSeconds(cue.endSec);
  if (!text || endSec <= startSec) return null;

  const scale = frameWidthPx / SUBTITLE_REFERENCE_WIDTH_PX;
  const hasBox = style.backgroundOpacity > 0;
  const gravity = GRAVITY_BY_POSITION[style.position];
  const paddedText = `${SUBTITLE_BOX_PADDING}${text}${SUBTITLE_BOX_PADDING}`;

  const textOverlay = {
    font_family: style.fontFamily,
    font_size: Math.round(style.fontSizePx * scale),
    ...(style.bold && { font_weight: 'bold' }),
    text_align: 'center',
    text: paddedText,
  };
  const width = Math.round(frameWidthPx * TEXT_WIDTH_RATIO);

  // The timeline position must sit on the component that applies the layer.
  // Offsets on the component that opens a text layer are ignored, which made
  // every cue show for the whole clip instead of only while it is spoken.
  const placement = (opacityPercent?: number): OverlayComponent => ({
    flags: 'layer_apply',
    gravity,
    start_offset: startSec,
    end_offset: endSec,
    ...(style.position !== 'MIDDLE' && {
      y: Math.round(EDGE_MARGIN_REFERENCE_PX * scale),
    }),
    ...(opacityPercent !== undefined && { opacity: opacityPercent }),
  });

  const textColor = `rgb:${style.textColor.replace('#', '')}`;
  const textLayer: OverlayComponent[] = [
    {
      overlay: textOverlay,
      color: textColor,
      width,
      // "limit" only shrinks a long line. "fit" also enlarged short text (one
      // word) until it filled the width, which made word subtitles huge.
      crop: 'limit',
    },
    placement(),
  ];
  if (!hasBox) return textLayer;

  if (boxMode === 'ALPHA') {
    // One layer: padded text, rounded box with the alpha channel.
    return [
      {
        overlay: textOverlay,
        color: textColor,
        background: toBackgroundColor(
          style.backgroundColor,
          style.backgroundOpacity,
        ),
        radius: Math.round(SUBTITLE_BOX_RADIUS_REFERENCE_PX * scale),
        width,
        crop: 'limit',
      },
      placement(),
    ];
  }

  const boxColor = style.backgroundColor.replace('#', '');
  const opacityPercent = Math.round(Math.min(1, style.backgroundOpacity) * 100);
  const boxLayer: OverlayComponent[] = [
    {
      overlay: textOverlay,
      // Same colour as the box, so the glyphs vanish into it.
      color: `rgb:${boxColor}`,
      background: `rgb:${boxColor}`,
      radius: Math.round(SUBTITLE_BOX_RADIUS_REFERENCE_PX * scale),
      width,
      crop: 'limit',
    },
    placement(opacityPercent < 100 ? opacityPercent : undefined),
  ];

  return [...boxLayer, ...textLayer];
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

export function formatSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(totalSec % 60, 2)},${pad(ms, 3)}`;
}

/**
 * Cues as an SRT file (times relative to the clip). One small file replaces
 * one text layer per cue, so the delivery URL no longer grows with the amount
 * of speech. Returns an empty string when no cue has visible text.
 */
export function buildSubtitleSrt(cues: SubtitleCue[]): string {
  const blocks: string[] = [];
  for (const cue of cues) {
    const text = normalizeCueText(cue.text);
    const startSec = roundSeconds(cue.startSec);
    const endSec = roundSeconds(cue.endSec);
    if (!text || endSec <= startSec) continue;
    blocks.push(
      `${blocks.length + 1}\n${formatSrtTime(startSec)} --> ${formatSrtTime(endSec)}\n${SUBTITLE_FILE_PADDING}${text}${SUBTITLE_FILE_PADDING}\n`,
    );
  }
  return blocks.join('\n');
}

/** The two transformation components that burn an uploaded SRT into the video. */
export function buildSubtitleFileLayers(
  style: SubtitleStyle,
  subtitleFilePublicId: string,
  frameWidthPx: number,
): OverlayComponent[] {
  const scale = frameWidthPx / SUBTITLE_REFERENCE_WIDTH_PX;
  const background = toBackgroundColor(
    style.backgroundColor,
    style.backgroundOpacity,
  );

  return [
    {
      overlay: {
        resource_type: 'subtitles',
        public_id: subtitleFilePublicId,
        font_family: style.fontFamily,
        font_size: Math.max(
          1,
          Math.round(style.fontSizePx * scale * SUBTITLE_FILE_FONT_SCALE),
        ),
        ...(style.bold && { font_weight: 'bold' }),
      },
      color: `rgb:${style.textColor.replace('#', '')}`,
      // No `radius` here: adding it to the subtitles layer made the text
      // render as empty boxes, so the burned-in box stays square.
      ...(background && { background }),
    },
    {
      flags: 'layer_apply',
      gravity: GRAVITY_BY_POSITION[style.position],
      ...(style.position !== 'MIDDLE' && {
        y: Math.round(EDGE_MARGIN_REFERENCE_PX * scale),
      }),
    },
  ];
}

export function buildSubtitleOverlay(
  burnIn: SubtitleBurnIn,
  frameWidthPx: number,
  boxMode: SubtitleBoxMode = DEFAULT_SUBTITLE_BOX_MODE,
): OverlayComponent[] {
  return burnIn.cues.flatMap(
    (cue) => buildCueLayer(cue, burnIn.style, frameWidthPx, boxMode) ?? [],
  );
}

function isStoredCue(value: unknown): value is SubtitleCue {
  if (typeof value !== 'object' || value === null) return false;
  const { index, startSec, endSec, text } = value as Record<string, unknown>;
  return (
    typeof index === 'number' &&
    typeof startSec === 'number' &&
    typeof endSec === 'number' &&
    Number.isFinite(startSec) &&
    Number.isFinite(endSec) &&
    typeof text === 'string'
  );
}

function isStoredStyle(value: unknown): value is SubtitleStyle {
  if (typeof value !== 'object' || value === null) return false;
  const style = value as Record<string, unknown>;
  return (
    typeof style.fontFamily === 'string' &&
    typeof style.fontSizePx === 'number' &&
    typeof style.bold === 'boolean' &&
    typeof style.textColor === 'string' &&
    typeof style.backgroundColor === 'string' &&
    typeof style.backgroundOpacity === 'number' &&
    typeof style.position === 'string'
  );
}

/**
 * Returns null for a render without subtitles. A render that has a style but
 * unreadable cues throws, so it can never silently produce a video without the
 * subtitles the user asked for.
 */
export function readStoredBurnIn(
  style: unknown,
  cues: unknown,
): SubtitleBurnIn | null {
  if (style === null || style === undefined) return null;

  if (!isStoredStyle(style) || !Array.isArray(cues)) {
    throw new Error('Stored subtitle data for the render is invalid');
  }
  const storedCues: unknown[] = cues;
  if (!storedCues.every(isStoredCue)) {
    throw new Error('Stored subtitle data for the render is invalid');
  }

  return { style, cues: storedCues };
}
