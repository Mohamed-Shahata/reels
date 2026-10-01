export const SUBTITLE_FONTS = ['Cairo', 'Amiri', 'Arial'] as const;
export type SubtitleFont = (typeof SUBTITLE_FONTS)[number];

export const SUBTITLE_POSITIONS = ['TOP', 'MIDDLE', 'BOTTOM'] as const;
export type SubtitlePosition = (typeof SUBTITLE_POSITIONS)[number];

/**
 * PHRASE shows a short line of a few words at a time. WORD shows one word at a
 * time, in step with the speaker.
 */
export const SUBTITLE_DISPLAY_MODES = ['PHRASE', 'WORD'] as const;
export type SubtitleDisplayMode = (typeof SUBTITLE_DISPLAY_MODES)[number];
export const DEFAULT_SUBTITLE_DISPLAY_MODE: SubtitleDisplayMode = 'PHRASE';

export const SUBTITLE_REFERENCE_WIDTH_PX = 720;

export const SUBTITLE_FONT_SIZE_LIMITS = { min: 20, max: 72 } as const;

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export interface SubtitleStyle {
  fontFamily: SubtitleFont;
  /** Size in pixels of the 720 px wide reel frame. */
  fontSizePx: number;
  bold: boolean;
  /** `#rrggbb`. */
  textColor: string;
  /** `#rrggbb`; only visible when `backgroundOpacity` is above zero. */
  backgroundColor: string;
  /** 0 is fully transparent, 1 is fully opaque. */
  backgroundOpacity: number;
  position: SubtitlePosition;
  /** Older renders were stored without it and show phrases. */
  displayMode: SubtitleDisplayMode;
}

export type SubtitleStyleOverrides = Partial<SubtitleStyle>;

export const SUBTITLE_PRESET_IDS = [
  'REEL',
  'HIGHLIGHT',
  'CLASSIC',
  'MINIMAL',
] as const;
export type SubtitlePresetId = (typeof SUBTITLE_PRESET_IDS)[number];

export interface SubtitleStylePreset {
  id: SubtitlePresetId;
  label: string;
  description: string;
  style: SubtitleStyle;
}

export const DEFAULT_SUBTITLE_PRESET_ID: SubtitlePresetId = 'REEL';

export const SUBTITLE_STYLE_PRESETS: readonly SubtitleStylePreset[] = [
  {
    id: 'REEL',
    label: 'Reel',
    description: 'Bold white text on a dark box. Readable on any footage.',
    style: {
      fontFamily: 'Cairo',
      fontSizePx: 34,
      bold: true,
      textColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.63,
      position: 'MIDDLE',
      displayMode: 'PHRASE',
    },
  },
  {
    id: 'HIGHLIGHT',
    label: 'Highlight',
    description: 'Large yellow text on a solid dark box for strong emphasis.',
    style: {
      fontFamily: 'Cairo',
      fontSizePx: 40,
      bold: true,
      textColor: '#facc15',
      backgroundColor: '#000000',
      backgroundOpacity: 0.85,
      position: 'MIDDLE',
      displayMode: 'PHRASE',
    },
  },
  {
    id: 'CLASSIC',
    label: 'Classic',
    description: 'Traditional Naskh lettering on a soft dark box.',
    style: {
      fontFamily: 'Amiri',
      fontSizePx: 36,
      bold: true,
      textColor: '#ffffff',
      backgroundColor: '#111827',
      backgroundOpacity: 0.55,
      position: 'BOTTOM',
      displayMode: 'PHRASE',
    },
  },
  {
    id: 'MINIMAL',
    label: 'Minimal',
    description: 'Clean neutral text with no box, placed near the top.',
    style: {
      fontFamily: 'Arial',
      fontSizePx: 30,
      bold: false,
      textColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      position: 'TOP',
      displayMode: 'PHRASE',
    },
  },
];

export interface SubtitleStyleCatalog {
  defaultPresetId: SubtitlePresetId;
  fonts: readonly SubtitleFont[];
  positions: readonly SubtitlePosition[];
  displayModes: readonly SubtitleDisplayMode[];
  fontSize: { min: number; max: number };
  presets: readonly SubtitleStylePreset[];
}

export function getSubtitleStyleCatalog(): SubtitleStyleCatalog {
  return {
    defaultPresetId: DEFAULT_SUBTITLE_PRESET_ID,
    fonts: SUBTITLE_FONTS,
    positions: SUBTITLE_POSITIONS,
    displayModes: SUBTITLE_DISPLAY_MODES,
    fontSize: { ...SUBTITLE_FONT_SIZE_LIMITS },
    presets: SUBTITLE_STYLE_PRESETS,
  };
}

export function getSubtitlePreset(id: SubtitlePresetId): SubtitleStylePreset {
  const preset = SUBTITLE_STYLE_PRESETS.find(
    (candidate) => candidate.id === id,
  );
  if (!preset) {
    throw new Error(`Unknown subtitle preset: ${id}`);
  }
  return preset;
}

export interface ResolvedSubtitleStyle {
  presetId: SubtitlePresetId;
  style: SubtitleStyle;
}

/**
 * Starts from a preset and applies only the overrides that are defined, so a
 * caller can change one property without restating the rest of the style.
 */
export function resolveSubtitleStyle(
  presetId: SubtitlePresetId = DEFAULT_SUBTITLE_PRESET_ID,
  overrides: SubtitleStyleOverrides = {},
): ResolvedSubtitleStyle {
  const style: SubtitleStyle = { ...getSubtitlePreset(presetId).style };
  const definedOverrides = Object.entries(overrides).filter(
    ([, value]) => value !== undefined,
  );
  Object.assign(style, Object.fromEntries(definedOverrides));

  return {
    presetId,
    style: {
      ...style,
      textColor: style.textColor.toLowerCase(),
      backgroundColor: style.backgroundColor.toLowerCase(),
    },
  };
}
