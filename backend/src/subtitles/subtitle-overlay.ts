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

// Distance kept between the text and the frame edge, measured on the 720 px
// reference frame. It matches the margin verified in the Arabic rendering spike
// so the text stays clear of the platform buttons on TikTok and Instagram.
const EDGE_MARGIN_REFERENCE_PX = 120;
const TEXT_WIDTH_RATIO = 0.9;

const GRAVITY_BY_POSITION: Record<SubtitlePosition, string> = {
  TOP: 'north',
  MIDDLE: 'center',
  BOTTOM: 'south',
};

const CONTROL_CHARACTERS = /\p{Cc}/gu;

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

function buildCueLayer(
  cue: SubtitleCue,
  style: SubtitleStyle,
  frameWidthPx: number,
): OverlayComponent[] | null {
  const text = normalizeCueText(cue.text);
  const startSec = roundSeconds(cue.startSec);
  const endSec = roundSeconds(cue.endSec);
  if (!text || endSec <= startSec) return null;

  const scale = frameWidthPx / SUBTITLE_REFERENCE_WIDTH_PX;
  const background = toBackgroundColor(
    style.backgroundColor,
    style.backgroundOpacity,
  );
  const gravity = GRAVITY_BY_POSITION[style.position];

  const layer: OverlayComponent = {
    overlay: {
      font_family: style.fontFamily,
      font_size: Math.round(style.fontSizePx * scale),
      ...(style.bold && { font_weight: 'bold' }),
      text_align: 'center',
      text,
    },
    color: `rgb:${style.textColor.replace('#', '')}`,
    width: Math.round(frameWidthPx * TEXT_WIDTH_RATIO),
    crop: 'fit',
    ...(background && { background }),
  };

  // The timeline position must sit on the component that applies the layer.
  // Offsets on the component that opens a text layer are ignored, which made
  // every cue show for the whole clip instead of only while it is spoken.
  const placement: OverlayComponent = {
    flags: 'layer_apply',
    gravity,
    start_offset: startSec,
    end_offset: endSec,
    ...(style.position !== 'MIDDLE' && {
      y: Math.round(EDGE_MARGIN_REFERENCE_PX * scale),
    }),
  };

  return [layer, placement];
}

export function buildSubtitleOverlay(
  burnIn: SubtitleBurnIn,
  frameWidthPx: number,
): OverlayComponent[] {
  return burnIn.cues.flatMap(
    (cue) => buildCueLayer(cue, burnIn.style, frameWidthPx) ?? [],
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
