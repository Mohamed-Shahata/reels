import type { SubtitleCue } from '../../../src/subtitles/subtitle-cue-builder';
import {
  buildSubtitleOverlay,
  normalizeCueText,
  readStoredBurnIn,
} from '../../../src/subtitles/subtitle-overlay';
import {
  getSubtitlePreset,
  type SubtitleStyle,
} from '../../../src/subtitles/subtitle-style';

const reelStyle = getSubtitlePreset('REEL').style;
const cues: SubtitleCue[] = [
  { index: 1, startSec: 0.5, endSec: 2.5, text: 'First line' },
  { index: 2, startSec: 2.5, endSec: 4.123, text: 'Second line' },
];

function layerOf(components: Record<string, unknown>[], cueIndex: number) {
  return components[cueIndex * 2];
}

function placementOf(components: Record<string, unknown>[], cueIndex: number) {
  return components[cueIndex * 2 + 1];
}

describe('buildSubtitleOverlay', () => {
  it('builds one timed text layer and one placement per cue', () => {
    const components = buildSubtitleOverlay({ style: reelStyle, cues }, 1080);

    expect(components).toHaveLength(4);
    expect(layerOf(components, 0)).toMatchObject({
      overlay: {
        font_family: 'Cairo',
        font_size: 51,
        font_weight: 'bold',
        text_align: 'center',
        text: 'First line',
      },
      color: 'rgb:ffffff',
      background: 'rgb:000000a1',
      crop: 'fit',
      width: 972,
    });
    expect(placementOf(components, 0)).toEqual({
      flags: 'layer_apply',
      gravity: 'center',
      start_offset: 0.5,
      end_offset: 2.5,
    });
  });

  it('times each cue on the layer_apply component, not on the text layer', () => {
    const components = buildSubtitleOverlay({ style: reelStyle, cues }, 1080);

    expect(layerOf(components, 0)).not.toHaveProperty('start_offset');
    expect(layerOf(components, 0)).not.toHaveProperty('end_offset');
    expect(placementOf(components, 1)).toMatchObject({
      flags: 'layer_apply',
      start_offset: 2.5,
      end_offset: 4.12,
    });
  });

  it.each([
    ['TOP', 'north', 180],
    ['MIDDLE', 'center', undefined],
    ['BOTTOM', 'south', 180],
  ] as const)(
    'places the %s position at gravity %s',
    (position, gravity, y) => {
      const style: SubtitleStyle = { ...reelStyle, position };

      const [, placement] = buildSubtitleOverlay(
        { style, cues: [cues[0]] },
        1080,
      );

      expect(placement).toMatchObject({ flags: 'layer_apply', gravity });
      if (y === undefined) {
        expect(placement).not.toHaveProperty('y');
      } else {
        expect(placement).toMatchObject({ y });
      }
    },
  );

  it('scales the font size from the 720 px reference frame to the output width', () => {
    const style: SubtitleStyle = { ...reelStyle, fontSizePx: 40 };

    const components = buildSubtitleOverlay({ style, cues }, 1080);

    expect(layerOf(components, 0)).toMatchObject({
      overlay: expect.objectContaining({ font_size: 60 }) as unknown,
    });
  });

  it('omits the background when the opacity is zero and the weight when not bold', () => {
    const style: SubtitleStyle = {
      ...getSubtitlePreset('MINIMAL').style,
    };

    const [layer, placement] = buildSubtitleOverlay(
      { style, cues: [cues[0]] },
      1080,
    );

    expect(layer).not.toHaveProperty('background');
    expect(layer.overlay).not.toHaveProperty('font_weight');
    expect(placement).toEqual({
      flags: 'layer_apply',
      gravity: 'north',
      y: 180,
      start_offset: 0.5,
      end_offset: 2.5,
    });
  });

  it('centers the text without a vertical offset for the middle position', () => {
    const style: SubtitleStyle = { ...reelStyle, position: 'MIDDLE' };

    const [, placement] = buildSubtitleOverlay(
      { style, cues: [cues[0]] },
      1080,
    );

    expect(placement).toEqual({
      flags: 'layer_apply',
      gravity: 'center',
      start_offset: 0.5,
      end_offset: 2.5,
    });
  });

  it('encodes the alpha channel from the opacity', () => {
    const style: SubtitleStyle = {
      ...reelStyle,
      backgroundColor: '#112233',
      backgroundOpacity: 1,
    };

    const [layer] = buildSubtitleOverlay({ style, cues: [cues[0]] }, 1080);

    expect(layer.background).toBe('rgb:112233ff');
  });

  it('skips empty cues and cues that do not last', () => {
    const components = buildSubtitleOverlay(
      {
        style: reelStyle,
        cues: [
          { index: 1, startSec: 0, endSec: 1, text: '   ' },
          { index: 2, startSec: 3, endSec: 3, text: 'No duration' },
          { index: 3, startSec: 4, endSec: 5, text: 'Kept' },
        ],
      },
      1080,
    );

    expect(components).toHaveLength(2);
    expect(layerOf(components, 0)).toMatchObject({
      overlay: expect.objectContaining({ text: 'Kept' }) as unknown,
    });
  });

  it('returns nothing for a clip without speech', () => {
    expect(buildSubtitleOverlay({ style: reelStyle, cues: [] }, 1080)).toEqual(
      [],
    );
  });
});

describe('normalizeCueText', () => {
  it('collapses whitespace and removes control characters', () => {
    expect(normalizeCueText('  a\tb\n\nc\u0000d  ')).toBe('a b c d');
  });
});

describe('readStoredBurnIn', () => {
  it('returns null when no style is stored', () => {
    expect(readStoredBurnIn(null, null)).toBeNull();
    expect(readStoredBurnIn(undefined, undefined)).toBeNull();
  });

  it('returns the stored style and cues', () => {
    expect(readStoredBurnIn(reelStyle, cues)).toEqual({
      style: reelStyle,
      cues,
    });
  });

  it('throws instead of dropping subtitles when the stored data is invalid', () => {
    expect(() => readStoredBurnIn(reelStyle, null)).toThrow(
      'Stored subtitle data for the render is invalid',
    );
    expect(() => readStoredBurnIn(reelStyle, [{ text: 1 }])).toThrow(
      'Stored subtitle data for the render is invalid',
    );
    expect(() => readStoredBurnIn({ fontFamily: 'Cairo' }, cues)).toThrow(
      'Stored subtitle data for the render is invalid',
    );
  });
});
