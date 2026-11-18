import type { SubtitleCue } from './subtitle-cue-builder';
import type {
  SubtitleStyle,
  SubtitlePresetId,
  SubtitlePosition,
} from './subtitle-style';

export type AssPresetId = 'CLEAN' | 'BOX' | 'HIGHLIGHT';

export interface AssBuilderOptions {
  playResX?: number;
  playResY?: number;
  preset?: AssPresetId | SubtitlePresetId;
  style?: Partial<SubtitleStyle>;
  title?: string;
}

export interface AssStyleConfig {
  fontName: string;
  fontSize: number;
  bold: boolean;
  primaryColor: string; // &HAABBGGRR
  secondaryColor: string;
  outlineColor: string;
  backColor: string;
  borderStyle: 1 | 3; // 1 = outline+shadow, 3 = bounding box
  outline: number;
  shadow: number;
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
}

const DEFAULT_PLAY_RES_X = 1080;
const DEFAULT_PLAY_RES_Y = 1920;
const REFERENCE_WIDTH = 720;

/**
 * Converts a hex color (#RRGGBB) and opacity (0-1) to ASS color format (&HAABBGGRR).
 * In ASS, alpha &H00 is fully opaque, and &HFF is fully transparent.
 */
export function hexToAssColor(hex: string, opacity = 1): string {
  const clean = hex.replace(/^#/, '');
  const r = clean.substring(0, 2);
  const g = clean.substring(2, 4);
  const b = clean.substring(4, 6);

  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  const alphaVal = Math.round((1 - clampedOpacity) * 255);
  const alphaHex = alphaVal.toString(16).padStart(2, '0').toUpperCase();

  // ASS uses BBGGRR order
  return `&H${alphaHex}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

/**
 * Formats seconds into ASS timestamp H:MM:SS.cs (centiseconds).
 */
export function formatAssTime(seconds: number): string {
  const nonNegative = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalCentiseconds = Math.floor(Math.round(nonNegative * 100));
  const cs = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);

  const pad = (n: number, width = 2) => n.toString().padStart(width, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/**
 * Escapes characters in subtitle text that conflict with ASS formatting.
 */
export function sanitizeAssText(text: string): string {
  return text
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r\n|\r|\n/g, '\\N')
    .trim();
}

/**
 * Resolves ASS style config from preset and optional style overrides.
 */
export function resolveAssStyleConfig(
  options: AssBuilderOptions = {},
): AssStyleConfig {
  const playResX = options.playResX ?? DEFAULT_PLAY_RES_X;
  const scale = playResX / REFERENCE_WIDTH;

  const preset = (options.preset || 'CLEAN').toUpperCase();
  const overrides = options.style || {};

  // Base font
  const fontName = overrides.fontFamily || 'Cairo';
  const baseFontSize = overrides.fontSizePx || 36;
  const fontSize = Math.round(baseFontSize * scale);
  const bold = overrides.bold !== undefined ? overrides.bold : true;

  // Position & Alignment
  const position: SubtitlePosition = overrides.position || 'BOTTOM';
  let alignment = 2; // bottom center
  let marginV = Math.round(280 * (playResX / 1080));

  if (position === 'TOP') {
    alignment = 8; // top center
    marginV = Math.round(240 * (playResX / 1080));
  } else if (position === 'MIDDLE') {
    alignment = 5; // middle center
    marginV = 0;
  }

  // Margin horizontal
  const marginL = Math.round(80 * scale);
  const marginR = Math.round(80 * scale);

  // Preset styles: CLEAN (white text + shadow), BOX (semi-transparent box), HIGHLIGHT (accent color)
  if (preset === 'BOX' || preset === 'REEL' || preset === 'CLASSIC') {
    const bgColor = overrides.backgroundColor || '#000000';
    const bgOpacity =
      overrides.backgroundOpacity !== undefined
        ? overrides.backgroundOpacity
        : 0.65;
    const txtColor = overrides.textColor || '#ffffff';

    return {
      fontName,
      fontSize,
      bold,
      primaryColor: hexToAssColor(txtColor, 1),
      secondaryColor: hexToAssColor(txtColor, 1),
      outlineColor: hexToAssColor(bgColor, bgOpacity),
      backColor: hexToAssColor(bgColor, bgOpacity),
      borderStyle: 3, // Opaque/translucent bounding box
      outline: Math.round(8 * scale), // Padding around text inside the box
      shadow: 0,
      alignment,
      marginL,
      marginR,
      marginV,
    };
  }

  if (preset === 'HIGHLIGHT') {
    // Brand emerald accent or yellow
    const accentColor = overrides.textColor || '#10B981';
    return {
      fontName,
      fontSize: Math.round(fontSize * 1.05),
      bold: true,
      primaryColor: hexToAssColor(accentColor, 1),
      secondaryColor: hexToAssColor(accentColor, 1),
      outlineColor: hexToAssColor('#000000', 0.9),
      backColor: hexToAssColor('#000000', 0.6),
      borderStyle: 1,
      outline: Math.round(3 * scale),
      shadow: Math.round(2 * scale),
      alignment,
      marginL,
      marginR,
      marginV,
    };
  }

  // Default: CLEAN (White text, outline, and drop shadow, no box)
  const txtColor = overrides.textColor || '#ffffff';
  return {
    fontName,
    fontSize,
    bold,
    primaryColor: hexToAssColor(txtColor, 1),
    secondaryColor: hexToAssColor(txtColor, 1),
    outlineColor: hexToAssColor('#000000', 0.85),
    backColor: hexToAssColor('#000000', 0.5),
    borderStyle: 1, // Outline + drop shadow
    outline: Math.round(2.5 * scale),
    shadow: Math.round(3.5 * scale),
    alignment,
    marginL,
    marginR,
    marginV,
  };
}

/**
 * Builds a complete .ass subtitle script string for burning via FFmpeg libass.
 */
export function buildAssSubtitles(
  cues: readonly SubtitleCue[],
  options: AssBuilderOptions = {},
): string {
  const playResX = options.playResX ?? DEFAULT_PLAY_RES_X;
  const playResY = options.playResY ?? DEFAULT_PLAY_RES_Y;
  const title = options.title || 'ReelCast Subtitles';

  const cfg = resolveAssStyleConfig(options);
  const boldFlag = cfg.bold ? -1 : 0;

  const header = [
    '[Script Info]',
    `Title: ${title}`,
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${cfg.fontName},${cfg.fontSize},${cfg.primaryColor},${cfg.secondaryColor},${cfg.outlineColor},${cfg.backColor},${boldFlag},0,0,0,100,100,0,0,${cfg.borderStyle},${cfg.outline},${cfg.shadow},${cfg.alignment},${cfg.marginL},${cfg.marginR},${cfg.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  // Specific position tags if positionX and positionY provided in overrides
  const posOverride =
    options.style?.positionX !== undefined &&
    options.style?.positionY !== undefined
      ? `{\\an5\\pos(${Math.round((options.style.positionX / 100) * playResX)},${Math.round((options.style.positionY / 100) * playResY)})}`
      : '';

  const events = cues.map((cue) => {
    const start = formatAssTime(cue.startSec);
    const end = formatAssTime(cue.endSec);
    const text = `${posOverride}${sanitizeAssText(cue.text)}`;
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });

  return `${header.join('\n')}\n${events.join('\n')}\n`;
}
