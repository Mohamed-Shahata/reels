import {
  DEFAULT_SUBTITLE_PRESET_ID,
  HEX_COLOR_PATTERN,
  SUBTITLE_FONT_SIZE_LIMITS,
  SUBTITLE_FONTS,
  SUBTITLE_POSITIONS,
  SUBTITLE_PRESET_IDS,
  SUBTITLE_STYLE_PRESETS,
  getSubtitlePreset,
  getSubtitleStyleCatalog,
  resolveSubtitleStyle,
} from '../../../src/subtitles/subtitle-style';

describe('subtitle style presets', () => {
  it('offers at least three presets', () => {
    expect(SUBTITLE_STYLE_PRESETS.length).toBeGreaterThanOrEqual(3);
  });

  it('has one preset per declared id, with unique ids', () => {
    const ids = SUBTITLE_STYLE_PRESETS.map((preset) => preset.id);

    expect([...ids].sort()).toEqual([...SUBTITLE_PRESET_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only supported fonts, positions, colors and sizes', () => {
    for (const { style } of SUBTITLE_STYLE_PRESETS) {
      expect(SUBTITLE_FONTS).toContain(style.fontFamily);
      expect(SUBTITLE_POSITIONS).toContain(style.position);
      expect(style.textColor).toMatch(HEX_COLOR_PATTERN);
      expect(style.backgroundColor).toMatch(HEX_COLOR_PATTERN);
      expect(style.fontSizePx).toBeGreaterThanOrEqual(
        SUBTITLE_FONT_SIZE_LIMITS.min,
      );
      expect(style.fontSizePx).toBeLessThanOrEqual(
        SUBTITLE_FONT_SIZE_LIMITS.max,
      );
      expect(style.backgroundOpacity).toBeGreaterThanOrEqual(0);
      expect(style.backgroundOpacity).toBeLessThanOrEqual(1);
    }
  });

  it('gives every preset a label and a description', () => {
    for (const preset of SUBTITLE_STYLE_PRESETS) {
      expect(preset.label.trim()).not.toBe('');
      expect(preset.description.trim()).not.toBe('');
    }
  });

  it('makes the presets visibly different from each other', () => {
    const serialized = SUBTITLE_STYLE_PRESETS.map((preset) =>
      JSON.stringify(preset.style),
    );

    expect(new Set(serialized).size).toBe(serialized.length);
  });

  it('rejects an unknown preset id', () => {
    expect(() => getSubtitlePreset('MISSING' as never)).toThrow(
      'Unknown subtitle preset',
    );
  });
});

describe('getSubtitleStyleCatalog', () => {
  it('lists the presets, the choices and the size limits', () => {
    const catalog = getSubtitleStyleCatalog();

    expect(catalog.defaultPresetId).toBe(DEFAULT_SUBTITLE_PRESET_ID);
    expect(catalog.fonts).toEqual(SUBTITLE_FONTS);
    expect(catalog.positions).toEqual(SUBTITLE_POSITIONS);
    expect(catalog.fontSize).toEqual(SUBTITLE_FONT_SIZE_LIMITS);
    expect(catalog.presets).toBe(SUBTITLE_STYLE_PRESETS);
  });

  it('has a default preset that exists', () => {
    const catalog = getSubtitleStyleCatalog();

    expect(catalog.presets.map((preset) => preset.id)).toContain(
      catalog.defaultPresetId,
    );
  });
});

describe('resolveSubtitleStyle', () => {
  it('uses the default preset when nothing is given', () => {
    const result = resolveSubtitleStyle();

    expect(result.presetId).toBe(DEFAULT_SUBTITLE_PRESET_ID);
    expect(result.style).toEqual(
      getSubtitlePreset(DEFAULT_SUBTITLE_PRESET_ID).style,
    );
  });

  it('returns the chosen preset unchanged without overrides', () => {
    const result = resolveSubtitleStyle('CLASSIC');

    expect(result).toEqual({
      presetId: 'CLASSIC',
      style: getSubtitlePreset('CLASSIC').style,
    });
  });

  it('applies only the overrides that are defined', () => {
    const result = resolveSubtitleStyle('REEL', {
      fontSizePx: 50,
      position: 'TOP',
      textColor: undefined,
    });

    expect(result.style).toEqual({
      ...getSubtitlePreset('REEL').style,
      fontSizePx: 50,
      position: 'TOP',
    });
  });

  it('keeps a falsy override such as a zero opacity or bold off', () => {
    const result = resolveSubtitleStyle('REEL', {
      backgroundOpacity: 0,
      bold: false,
    });

    expect(result.style.backgroundOpacity).toBe(0);
    expect(result.style.bold).toBe(false);
  });

  it('lowercases colors', () => {
    const result = resolveSubtitleStyle('REEL', {
      textColor: '#FACC15',
      backgroundColor: '#0A0B0C',
    });

    expect(result.style.textColor).toBe('#facc15');
    expect(result.style.backgroundColor).toBe('#0a0b0c');
  });

  it('never changes the preset definitions', () => {
    const before = JSON.stringify(SUBTITLE_STYLE_PRESETS);

    resolveSubtitleStyle('REEL', { fontSizePx: 60, textColor: '#123456' });

    expect(JSON.stringify(SUBTITLE_STYLE_PRESETS)).toBe(before);
  });
});
