import type { CSSProperties } from 'react';
import {
  subtitleStyleSchema,
  type SubtitleStyle,
  type SubtitleStyleCatalog,
  type SubtitleStylePreset,
} from './api';

export const SUBTITLE_STYLE_STORAGE_KEY = 'podcast-reels:subtitle-style';
export const SUBTITLE_REFERENCE_WIDTH_PX = 720;
export const SUBTITLE_BOX_RADIUS_REFERENCE_PX = 14;

export interface SubtitleSelection {
  presetId: string;
  style: SubtitleStyle;
}

export const FONT_STACKS: Record<SubtitleStyle['fontFamily'], string> = {
  Cairo: 'var(--font-cairo), Cairo, Tahoma, sans-serif',
  Amiri: 'var(--font-amiri), Amiri, "Times New Roman", serif',
  Arial: 'Arial, Helvetica, sans-serif',
};

export function findPreset(
  catalog: SubtitleStyleCatalog,
  presetId: string,
): SubtitleStylePreset {
  return (
    catalog.presets.find((preset) => preset.id === presetId) ??
    catalog.presets.find((preset) => preset.id === catalog.defaultPresetId) ??
    catalog.presets[0]
  );
}

export function selectPreset(
  catalog: SubtitleStyleCatalog,
  presetId: string,
): SubtitleSelection {
  const preset = findPreset(catalog, presetId);
  return { presetId: preset.id, style: { ...preset.style } };
}

export function changeStyle(
  selection: SubtitleSelection,
  patch: Partial<SubtitleStyle>,
): SubtitleSelection {
  return { ...selection, style: { ...selection.style, ...patch } };
}

export function isCustomized(
  catalog: SubtitleStyleCatalog,
  selection: SubtitleSelection,
): boolean {
  const preset = findPreset(catalog, selection.presetId);
  const keys = Object.keys(preset.style) as (keyof SubtitleStyle)[];
  return keys.some((key) => {
    const current = selection.style[key];
    const original = preset.style[key];
    return typeof current === 'string' && typeof original === 'string'
      ? current.toLowerCase() !== original.toLowerCase()
      : current !== original;
  });
}

export function isStyleAllowed(
  catalog: SubtitleStyleCatalog,
  style: SubtitleStyle,
): boolean {
  return (
    catalog.fonts.includes(style.fontFamily) &&
    catalog.positions.includes(style.position) &&
    style.fontSizePx >= catalog.fontSize.min &&
    style.fontSizePx <= catalog.fontSize.max
  );
}

export function restoreSelection(
  catalog: SubtitleStyleCatalog,
  stored: unknown,
): SubtitleSelection {
  const fallback = selectPreset(catalog, catalog.defaultPresetId);
  if (typeof stored !== 'object' || stored === null) return fallback;

  const { presetId, style } = stored as Record<string, unknown>;
  const parsed = subtitleStyleSchema.safeParse(style);
  if (
    typeof presetId !== 'string' ||
    !catalog.presets.some((preset) => preset.id === presetId) ||
    !parsed.success ||
    !isStyleAllowed(catalog, parsed.data)
  ) {
    return fallback;
  }

  return { presetId, style: parsed.data };
}

export function loadStoredSelection(
  catalog: SubtitleStyleCatalog,
): SubtitleSelection {
  try {
    const raw = window.localStorage.getItem(SUBTITLE_STYLE_STORAGE_KEY);
    return restoreSelection(catalog, raw === null ? null : JSON.parse(raw));
  } catch {
    return selectPreset(catalog, catalog.defaultPresetId);
  }
}

export function storeSelection(selection: SubtitleSelection): void {
  try {
    window.localStorage.setItem(
      SUBTITLE_STYLE_STORAGE_KEY,
      JSON.stringify(selection),
    );
  } catch {
    return;
  }
}

export function hexToRgba(hex: string, opacity: number): string {
  const value = hex.replace('#', '');
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  const alpha = Math.min(1, Math.max(0, opacity));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function getPreviewTextStyle(style: SubtitleStyle): CSSProperties {
  const sizeRatio = style.fontSizePx / SUBTITLE_REFERENCE_WIDTH_PX;
  return {
    fontFamily: FONT_STACKS[style.fontFamily],
    fontSize: `${(sizeRatio * 100).toFixed(3)}cqw`,
    fontWeight: style.bold ? 700 : 400,
    color: style.textColor,
    backgroundColor: hexToRgba(style.backgroundColor, style.backgroundOpacity),
    // Same curve as the burned-in box: 14 px on the 720 px reference frame.
    borderRadius: `${((SUBTITLE_BOX_RADIUS_REFERENCE_PX / SUBTITLE_REFERENCE_WIDTH_PX) * 100).toFixed(3)}cqw`,
  };
}

export function getPreviewPositionStyle(
  position: SubtitleStyle['position'],
): CSSProperties {
  switch (position) {
    case 'TOP':
      return { top: '12%' };
    case 'MIDDLE':
      return { top: '50%', transform: 'translateY(-50%)' };
    case 'BOTTOM':
      return { bottom: '12%' };
  }
}
