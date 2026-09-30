import type { SubtitleStyle } from '@/lib/api';
import {
  BURN_IN_STORAGE_KEY,
  hasClipOverrides,
  isBurnInEnabled,
  loadStoredBurnIn,
  resolveVariant,
  setClipBurnIn,
  setGlobalBurnIn,
  storeBurnIn,
  toRenderOptions,
} from '@/lib/burn-in';

const style: SubtitleStyle = {
  fontFamily: 'Cairo',
  fontSizePx: 34,
  bold: true,
  textColor: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 0.63,
  position: 'BOTTOM',
};

describe('burn-in settings', () => {
  it('applies the global toggle to every clip', () => {
    const on = setGlobalBurnIn(true);

    expect(isBurnInEnabled(on, 'clip-1')).toBe(true);
    expect(isBurnInEnabled(setGlobalBurnIn(false), 'clip-1')).toBe(false);
  });

  it('lets one clip differ from the global toggle', () => {
    const settings = setClipBurnIn(setGlobalBurnIn(true), 'clip-1', false);

    expect(isBurnInEnabled(settings, 'clip-1')).toBe(false);
    expect(isBurnInEnabled(settings, 'clip-2')).toBe(true);
    expect(hasClipOverrides(settings)).toBe(true);
  });

  it('drops an override that matches the global toggle again', () => {
    const differing = setClipBurnIn(setGlobalBurnIn(false), 'clip-1', true);

    const settings = setClipBurnIn(differing, 'clip-1', false);

    expect(hasClipOverrides(settings)).toBe(false);
  });

  it('clears every clip override when the global toggle changes', () => {
    const differing = setClipBurnIn(setGlobalBurnIn(false), 'clip-1', true);

    const settings = setGlobalBurnIn(true);

    expect(hasClipOverrides(settings)).toBe(false);
    expect(isBurnInEnabled(settings, 'clip-1')).toBe(true);
    expect(isBurnInEnabled(differing, 'clip-1')).toBe(true);
  });

  it('does not change the settings it is given', () => {
    const base = setGlobalBurnIn(false);

    setClipBurnIn(base, 'clip-1', true);

    expect(base.overrides).toEqual({});
  });
});

describe('resolveVariant', () => {
  it('is the plain variant when subtitles are off or the style is missing', () => {
    expect(resolveVariant(false, style)).toEqual({ subtitles: false });
    expect(resolveVariant(true, null)).toEqual({ subtitles: false });
  });

  it('carries the style when subtitles are on', () => {
    expect(resolveVariant(true, style)).toEqual({ subtitles: true, style });
  });
});

describe('toRenderOptions', () => {
  it('sends only the toggle when subtitles are off', () => {
    expect(
      toRenderOptions({ subtitles: false }, { presetId: 'REEL', style }),
    ).toEqual({ subtitles: false });
  });

  it('sends the preset and the full style when subtitles are on', () => {
    expect(
      toRenderOptions(
        { subtitles: true, style },
        { presetId: 'HIGHLIGHT', style },
      ),
    ).toEqual({ subtitles: true, presetId: 'HIGHLIGHT', style });
  });
});

describe('stored global toggle', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to off', () => {
    expect(loadStoredBurnIn()).toBe(false);
  });

  it('remembers the choice', () => {
    storeBurnIn(true);

    expect(window.localStorage.getItem(BURN_IN_STORAGE_KEY)).toBe('true');
    expect(loadStoredBurnIn()).toBe(true);
  });

  it('falls back to off when storage is unavailable', () => {
    const getItem = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });

    expect(loadStoredBurnIn()).toBe(false);
    expect(() => storeBurnIn(true)).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe('burn-in with edited text', () => {
  const edits = [{ index: 2, text: 'Fixed line' }];

  it('keeps the edits in the render variant', () => {
    expect(resolveVariant(true, style, edits)).toEqual({
      subtitles: true,
      style,
      edits,
    });
  });

  it('leaves the edits out when there are none', () => {
    expect(resolveVariant(true, style, [])).toEqual({ subtitles: true, style });
  });

  it('drops the edits when subtitles are off', () => {
    expect(resolveVariant(false, style, edits)).toEqual({ subtitles: false });
  });

  it('sends the edits with the render options', () => {
    expect(
      toRenderOptions(resolveVariant(true, style, edits), null),
    ).toMatchObject({ subtitles: true, style, edits });
  });

  it('sends no edits when the text was not edited', () => {
    expect(
      toRenderOptions(resolveVariant(true, style), null),
    ).not.toHaveProperty('edits');
  });
});
