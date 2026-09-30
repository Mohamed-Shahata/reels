import type { RenderRequestOptions, SubtitleEdit, SubtitleStyle } from './api';
import type { RenderVariant } from './clip-render';
import type { SubtitleSelection } from './subtitle-style';

export const BURN_IN_STORAGE_KEY = 'podcast-reels:burn-subtitles';

export interface BurnInSettings {
  enabled: boolean;
  overrides: Record<string, boolean>;
}

export function isBurnInEnabled(
  settings: BurnInSettings,
  clipId: string,
): boolean {
  return settings.overrides[clipId] ?? settings.enabled;
}

export function setGlobalBurnIn(enabled: boolean): BurnInSettings {
  return { enabled, overrides: {} };
}

export function setClipBurnIn(
  settings: BurnInSettings,
  clipId: string,
  enabled: boolean,
): BurnInSettings {
  const overrides = { ...settings.overrides };
  if (enabled === settings.enabled) {
    delete overrides[clipId];
  } else {
    overrides[clipId] = enabled;
  }
  return { ...settings, overrides };
}

export function hasClipOverrides(settings: BurnInSettings): boolean {
  return Object.keys(settings.overrides).length > 0;
}

export function resolveVariant(
  enabled: boolean,
  style: SubtitleStyle | null,
  edits: SubtitleEdit[] = [],
): RenderVariant {
  if (!enabled || !style) return { subtitles: false };
  return edits.length > 0
    ? { subtitles: true, style, edits }
    : { subtitles: true, style };
}

export function toRenderOptions(
  variant: RenderVariant,
  selection: SubtitleSelection | null,
): RenderRequestOptions {
  if (!variant.subtitles) return { subtitles: false };
  return {
    subtitles: true,
    presetId: selection?.presetId,
    style: variant.style,
    ...(variant.edits?.length && { edits: variant.edits }),
  };
}

export function loadStoredBurnIn(): boolean {
  try {
    return window.localStorage.getItem(BURN_IN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function storeBurnIn(enabled: boolean): void {
  try {
    window.localStorage.setItem(BURN_IN_STORAGE_KEY, String(enabled));
  } catch {
    return;
  }
}
