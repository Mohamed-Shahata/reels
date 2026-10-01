import type { SubtitleCue } from '../../../src/subtitles/subtitle-cue-builder';
import {
  buildSubtitleFileLayers,
  buildSubtitleOverlay,
  buildSubtitleSrt,
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

// Two non-breaking spaces on each side of the text give the box side padding.
const BOX_PAD = '\u00a0\u00a0';

// With a background every cue is two [layer, placement] pairs: the box first,
// then the text on top. Without one it is only the text pair.
const BOX_PAIR = 0;
const TEXT_PAIR = 1;

function layerOf(components: Record<string, unknown>[], pairIndex: number) {
  return components[pairIndex * 2];
}

function placementOf(components: Record<string, unknown>[], pairIndex: number) {
  return components[pairIndex * 2 + 1];
}

describe('buildSubtitleOverlay (ALPHA, the default)', () => {
  it('draws one padded layer per cue with the alpha in the box colour', () => {
    const components = buildSubtitleOverlay({ style: reelStyle, cues }, 1080);

    expect(components).toHaveLength(4);
    expect(layerOf(components, 0)).toMatchObject({
      overlay: { text: `${BOX_PAD}First line${BOX_PAD}` },
      color: 'rgb:ffffff',
      background: 'rgb:000000a1',
      radius: 21,
      width: 972,
      crop: 'limit',
    });
    expect(placementOf(components, 0)).toEqual({
      flags: 'layer_apply',
      gravity: 'center',
      start_offset: 0.5,
      end_offset: 2.5,
    });
  });

  it('draws no box when the opacity is zero', () => {
    const components = buildSubtitleOverlay(
      { style: getSubtitlePreset('MINIMAL').style, cues: [cues[0]] },
      1080,
    );

    expect(components).toHaveLength(2);
    expect(layerOf(components, 0)).not.toHaveProperty('background');
  });
});

describe('buildSubtitleOverlay (LAYERED)', () => {
  it('draws a box layer and a text layer per cue when there is a background', () => {
    const components = buildSubtitleOverlay(
      { style: reelStyle, cues },
      1080,
      'LAYERED',
    );

    expect(components).toHaveLength(8);
    expect(layerOf(components, BOX_PAIR)).toMatchObject({
      overlay: {
        font_family: 'Cairo',
        font_size: 51,
        font_weight: 'bold',
        text_align: 'center',
        text: `${BOX_PAD}First line${BOX_PAD}`,
      },
      // Text and box share a colour, so only the rounded box shows.
      color: 'rgb:000000',
      background: 'rgb:000000',
      crop: 'limit',
      radius: 21,
      width: 972,
    });
    expect(layerOf(components, TEXT_PAIR)).toMatchObject({
      overlay: { text: `${BOX_PAD}First line${BOX_PAD}` },
      color: 'rgb:ffffff',
      crop: 'limit',
      width: 972,
    });
    expect(layerOf(components, TEXT_PAIR)).not.toHaveProperty('background');
  });

  it('applies the background opacity to the box layer and keeps the text opaque', () => {
    const components = buildSubtitleOverlay(
      { style: reelStyle, cues },
      1080,
      'LAYERED',
    );

    expect(placementOf(components, BOX_PAIR)).toEqual({
      flags: 'layer_apply',
      gravity: 'center',
      start_offset: 0.5,
      end_offset: 2.5,
      opacity: 63,
    });
    expect(placementOf(components, TEXT_PAIR)).toEqual({
      flags: 'layer_apply',
      gravity: 'center',
      start_offset: 0.5,
      end_offset: 2.5,
    });
    expect(layerOf(components, BOX_PAIR)).not.toHaveProperty('opacity');
  });

  it('times each cue on the layer_apply component, not on the text layer', () => {
    const components = buildSubtitleOverlay(
      { style: reelStyle, cues },
      1080,
      'LAYERED',
    );

    for (const pair of [0, 1, 2, 3]) {
      expect(layerOf(components, pair)).not.toHaveProperty('start_offset');
      expect(layerOf(components, pair)).not.toHaveProperty('end_offset');
    }
    expect(placementOf(components, 2)).toMatchObject({
      flags: 'layer_apply',
      start_offset: 2.5,
      end_offset: 4.12,
    });
    expect(placementOf(components, 3)).toMatchObject({
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
    'places the %s position at gravity %s on both layers',
    (position, gravity, y) => {
      const style: SubtitleStyle = { ...reelStyle, position };

      const components = buildSubtitleOverlay(
        { style, cues: [cues[0]] },
        1080,
        'LAYERED',
      );

      for (const pair of [BOX_PAIR, TEXT_PAIR]) {
        const placement = placementOf(components, pair);
        expect(placement).toMatchObject({ flags: 'layer_apply', gravity });
        if (y === undefined) {
          expect(placement).not.toHaveProperty('y');
        } else {
          expect(placement).toMatchObject({ y });
        }
      }
    },
  );

  it('scales the font size from the 720 px reference frame to the output width', () => {
    const style: SubtitleStyle = { ...reelStyle, fontSizePx: 40 };

    const components = buildSubtitleOverlay({ style, cues }, 1080, 'LAYERED');

    for (const pair of [BOX_PAIR, TEXT_PAIR]) {
      expect(layerOf(components, pair)).toMatchObject({
        overlay: expect.objectContaining({ font_size: 60 }) as unknown,
      });
    }
  });

  it('draws only the text, padded, when the opacity is zero', () => {
    const style: SubtitleStyle = {
      ...getSubtitlePreset('MINIMAL').style,
    };

    const components = buildSubtitleOverlay(
      { style, cues: [cues[0]] },
      1080,
      'LAYERED',
    );
    const [layer, placement] = components;

    expect(components).toHaveLength(2);
    expect(layer).not.toHaveProperty('background');
    expect(layer).not.toHaveProperty('radius');
    expect(layer.overlay).not.toHaveProperty('font_weight');
    expect(layer.overlay).toMatchObject({
      text: `${BOX_PAD}First line${BOX_PAD}`,
    });
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

    const components = buildSubtitleOverlay(
      { style, cues: [cues[0]] },
      1080,
      'LAYERED',
    );

    expect(placementOf(components, TEXT_PAIR)).toEqual({
      flags: 'layer_apply',
      gravity: 'center',
      start_offset: 0.5,
      end_offset: 2.5,
    });
  });

  it('turns the opacity into a layer percentage and omits it when fully opaque', () => {
    const half: SubtitleStyle = {
      ...reelStyle,
      backgroundColor: '#112233',
      backgroundOpacity: 0.5,
    };
    const solid: SubtitleStyle = { ...half, backgroundOpacity: 1 };

    const halfComponents = buildSubtitleOverlay(
      { style: half, cues: [cues[0]] },
      1080,
      'LAYERED',
    );
    const solidComponents = buildSubtitleOverlay(
      { style: solid, cues: [cues[0]] },
      1080,
      'LAYERED',
    );

    expect(layerOf(halfComponents, BOX_PAIR)).toMatchObject({
      background: 'rgb:112233',
      color: 'rgb:112233',
    });
    expect(placementOf(halfComponents, BOX_PAIR)).toMatchObject({
      opacity: 50,
    });
    expect(placementOf(solidComponents, BOX_PAIR)).not.toHaveProperty(
      'opacity',
    );
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
      'LAYERED',
    );

    expect(components).toHaveLength(4);
    expect(layerOf(components, TEXT_PAIR)).toMatchObject({
      overlay: expect.objectContaining({
        text: `${BOX_PAD}Kept${BOX_PAD}`,
      }) as unknown,
    });
  });

  it('returns nothing for a clip without speech', () => {
    expect(
      buildSubtitleOverlay({ style: reelStyle, cues: [] }, 1080, 'LAYERED'),
    ).toEqual([]);
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

// Every cue is padded with non-breaking spaces so Arabic words are not clipped.
const PAD = '\u00a0\u00a0';

describe('buildSubtitleSrt', () => {
  it('formats cues as numbered SRT blocks', () => {
    const srt = buildSubtitleSrt([
      { index: 1, startSec: 0.5, endSec: 2, text: 'First' },
      { index: 2, startSec: 3661.25, endSec: 3663, text: '  Second\nline ' },
    ]);
    expect(srt).toBe(
      `1\n00:00:00,500 --> 00:00:02,000\n${PAD}First${PAD}\n\n2\n01:01:01,250 --> 01:01:03,000\n${PAD}Second line${PAD}\n`,
    );
  });

  it('skips empty and zero length cues and renumbers', () => {
    const srt = buildSubtitleSrt([
      { index: 1, startSec: 0, endSec: 1, text: '   ' },
      { index: 2, startSec: 2, endSec: 2, text: 'No time' },
      { index: 3, startSec: 3, endSec: 4, text: 'Kept' },
    ]);
    expect(srt).toBe(`1\n00:00:03,000 --> 00:00:04,000\n${PAD}Kept${PAD}\n`);
  });

  it('returns an empty string without cues', () => {
    expect(buildSubtitleSrt([])).toBe('');
  });
});

describe('buildSubtitleFileLayers', () => {
  it('scales the font down for the SRT layer and keeps cue text untouched', () => {
    const [layer] = buildSubtitleFileLayers(reelStyle, 'reelsubsabc.srt', 1080);
    expect(layer).toMatchObject({
      overlay: { resource_type: 'subtitles', font_size: 15 },
    });
    const srt = buildSubtitleSrt([
      { index: 1, startSec: 0, endSec: 1, text: 'مرحبا' },
    ]);
    expect(srt).toBe(`1\n00:00:00,000 --> 00:00:01,000\n${PAD}مرحبا${PAD}\n`);
  });
});
