import {
  SUBTITLE_STYLE_STORAGE_KEY,
  changeStyle,
  findPreset,
  getPreviewPositionStyle,
  getPreviewTextStyle,
  hexToRgba,
  isCustomized,
  isStyleAllowed,
  loadStoredSelection,
  restoreSelection,
  selectPreset,
  storeSelection,
} from '@/lib/subtitle-style';
import { subtitleCatalog } from '../support/subtitle-catalog';

describe('subtitle style selection', () => {
  it('selects a preset with a copy of its style', () => {
    const selection = selectPreset(subtitleCatalog, 'HIGHLIGHT');

    expect(selection.presetId).toBe('HIGHLIGHT');
    expect(selection.style).toEqual(subtitleCatalog.presets[1].style);
    expect(selection.style).not.toBe(subtitleCatalog.presets[1].style);
  });

  it('falls back to the default preset for an unknown id', () => {
    expect(findPreset(subtitleCatalog, 'MISSING').id).toBe('REEL');
    expect(selectPreset(subtitleCatalog, 'MISSING').presetId).toBe('REEL');
  });

  it('changes one property without touching the preset or the rest', () => {
    const selection = selectPreset(subtitleCatalog, 'REEL');

    const next = changeStyle(selection, { fontSizePx: 50 });

    expect(next.presetId).toBe('REEL');
    expect(next.style).toEqual({ ...selection.style, fontSizePx: 50 });
    expect(subtitleCatalog.presets[0].style.fontSizePx).toBe(34);
  });

  it('reports whether the style differs from its preset', () => {
    const selection = selectPreset(subtitleCatalog, 'REEL');

    expect(isCustomized(subtitleCatalog, selection)).toBe(false);
    expect(
      isCustomized(subtitleCatalog, changeStyle(selection, { bold: false })),
    ).toBe(true);
    expect(
      isCustomized(
        subtitleCatalog,
        changeStyle(selection, { textColor: '#FFFFFF' }),
      ),
    ).toBe(false);
  });
});

describe('isStyleAllowed', () => {
  const style = subtitleCatalog.presets[0].style;

  it('accepts every preset style', () => {
    for (const preset of subtitleCatalog.presets) {
      expect(isStyleAllowed(subtitleCatalog, preset.style)).toBe(true);
    }
  });

  it('rejects sizes outside the limits', () => {
    expect(isStyleAllowed(subtitleCatalog, { ...style, fontSizePx: 19 })).toBe(
      false,
    );
    expect(isStyleAllowed(subtitleCatalog, { ...style, fontSizePx: 73 })).toBe(
      false,
    );
  });

  it('rejects a font or position the catalog does not offer', () => {
    const narrow = { ...subtitleCatalog, fonts: ['Arial' as const] };

    expect(isStyleAllowed(narrow, style)).toBe(false);
    expect(
      isStyleAllowed(
        { ...subtitleCatalog, positions: ['TOP' as const] },
        style,
      ),
    ).toBe(false);
  });
});

describe('restoreSelection', () => {
  const stored = {
    presetId: 'HIGHLIGHT',
    style: { ...subtitleCatalog.presets[1].style, fontSizePx: 55 },
  };

  function withStyle(patch: Record<string, unknown>) {
    return { ...stored, style: { ...stored.style, ...patch } };
  }

  it('restores a valid stored selection', () => {
    expect(restoreSelection(subtitleCatalog, stored)).toEqual(stored);
  });

  it.each([
    ['nothing stored', null],
    ['a string', 'REEL'],
    ['an unknown preset', { ...stored, presetId: 'NEON' }],
    ['a missing style', { presetId: 'REEL' }],
    ['an invalid color', withStyle({ textColor: 'red' })],
    ['an oversized font', withStyle({ fontSizePx: 500 })],
    ['an unsupported font', withStyle({ fontFamily: 'Tahoma' })],
  ])('falls back to the default preset for %s', (_name, value) => {
    expect(restoreSelection(subtitleCatalog, value)).toEqual(
      selectPreset(subtitleCatalog, 'REEL'),
    );
  });
});

describe('stored selection', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round trips through local storage', () => {
    const selection = changeStyle(selectPreset(subtitleCatalog, 'MINIMAL'), {
      fontSizePx: 44,
    });

    storeSelection(selection);

    expect(loadStoredSelection(subtitleCatalog)).toEqual(selection);
  });

  it('uses the default preset when nothing was stored', () => {
    expect(loadStoredSelection(subtitleCatalog)).toEqual(
      selectPreset(subtitleCatalog, 'REEL'),
    );
  });

  it('uses the default preset when the stored value is not JSON', () => {
    window.localStorage.setItem(SUBTITLE_STYLE_STORAGE_KEY, '{broken');

    expect(loadStoredSelection(subtitleCatalog)).toEqual(
      selectPreset(subtitleCatalog, 'REEL'),
    );
  });

  it('does not throw when storage is unavailable', () => {
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });

    expect(() =>
      storeSelection(selectPreset(subtitleCatalog, 'REEL')),
    ).not.toThrow();

    setItem.mockRestore();
  });
});

describe('preview styles', () => {
  it('converts a hex color and opacity to rgba', () => {
    expect(hexToRgba('#facc15', 0.5)).toBe('rgba(250, 204, 21, 0.5)');
    expect(hexToRgba('#000000', 2)).toBe('rgba(0, 0, 0, 1)');
    expect(hexToRgba('#000000', -1)).toBe('rgba(0, 0, 0, 0)');
  });

  it('scales the font size to the 720 px reel width', () => {
    const css = getPreviewTextStyle(subtitleCatalog.presets[0].style);

    expect(css.fontSize).toBe('4.722cqw');
    expect(css.fontWeight).toBe(700);
    expect(css.color).toBe('#ffffff');
    expect(css.backgroundColor).toBe('rgba(0, 0, 0, 0.63)');
  });

  it('uses a regular weight and a transparent box when asked', () => {
    const css = getPreviewTextStyle(subtitleCatalog.presets[2].style);

    expect(css.fontWeight).toBe(400);
    expect(css.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(css.fontFamily).toContain('Arial');
  });

  it('maps each font to a stack with a fallback', () => {
    const cairo = getPreviewTextStyle(subtitleCatalog.presets[0].style);
    const amiri = getPreviewTextStyle({
      ...subtitleCatalog.presets[0].style,
      fontFamily: 'Amiri',
    });

    expect(cairo.fontFamily).toContain('Cairo');
    expect(amiri.fontFamily).toContain('Amiri');
    expect(amiri.fontFamily).toContain('serif');
  });

  it('places the subtitle at the top, middle or bottom', () => {
    expect(getPreviewPositionStyle('TOP')).toEqual({ top: '12%' });
    expect(getPreviewPositionStyle('MIDDLE')).toEqual({
      top: '50%',
      transform: 'translateY(-50%)',
    });
    expect(getPreviewPositionStyle('BOTTOM')).toEqual({ bottom: '12%' });
  });
});
