import {
  buildSubtitleCues,
  estimateWordTimings,
  type SubtitleWord,
} from '../../../src/subtitles/subtitle-cue-builder';

function word(
  text: string,
  startSec: number,
  endSec: number,
  estimated = false,
): SubtitleWord {
  return { text, startSec, endSec, estimated };
}

// Builds back-to-back words of equal length starting at `startSec`.
function run(
  texts: string[],
  startSec: number,
  lengthSec: number,
): SubtitleWord[] {
  return texts.map((text, position) =>
    word(
      text,
      startSec + position * lengthSec,
      startSec + (position + 1) * lengthSec,
    ),
  );
}

describe('buildSubtitleCues', () => {
  describe('timing relative to the clip', () => {
    it('offsets word times by the clip start', () => {
      const cues = buildSubtitleCues(
        [word('hello', 100.5, 100.9), word('world', 101, 101.5)],
        100,
        110,
      );

      expect(cues).toEqual([
        { index: 1, startSec: 0.5, endSec: 1.5, text: 'hello world' },
      ]);
    });

    it('uses the first word start and last word end as the cue timing', () => {
      const cues = buildSubtitleCues(
        [word('one', 62.25, 62.6), word('two', 62.7, 63.125)],
        60,
        70,
      );

      expect(cues[0].startSec).toBe(2.25);
      expect(cues[0].endSec).toBe(3.125);
    });

    it('ignores words outside the clip range', () => {
      const cues = buildSubtitleCues(
        [
          word('before', 90, 90.5),
          word('inside', 105, 105.5),
          word('after', 130, 130.5),
        ],
        100,
        110,
      );

      expect(cues.map((cue) => cue.text)).toEqual(['inside']);
      expect(cues[0].startSec).toBe(5);
    });

    it('keeps a word only when its midpoint is inside the clip', () => {
      const cues = buildSubtitleCues(
        [
          // Midpoint 100.1 is inside: kept, and clamped to start at 0.
          word('kept-start', 99.8, 100.4),
          // Midpoint 99.9 is outside: dropped rather than shown as a fragment.
          word('dropped-start', 99.5, 100.3),
          // Midpoint 109.9 is inside: kept.
          word('kept-end', 109.5, 110.3),
          // Midpoint 110.1 is outside: dropped.
          word('dropped-end', 109.8, 110.4),
        ],
        100,
        110,
      );

      expect(cues.map((cue) => cue.text)).toEqual(['kept-start', 'kept-end']);
    });

    it('keeps every time inside the clip duration', () => {
      const cues = buildSubtitleCues([word('edge', 99.85, 100.2)], 100, 110);

      expect(cues[0].startSec).toBe(0);
      const last = buildSubtitleCues([word('edge', 109.7, 110.2)], 100, 110);
      expect(last[0].endSec).toBe(10);
    });

    it('sorts words that arrive out of order', () => {
      const cues = buildSubtitleCues(
        [word('second', 1, 1.4), word('first', 0.5, 0.9)],
        0,
        10,
      );

      expect(cues[0].text).toBe('first second');
    });

    it('returns no cues for an empty or invalid clip range', () => {
      const words = [word('hello', 1, 2)];

      expect(buildSubtitleCues([], 0, 10)).toEqual([]);
      expect(buildSubtitleCues(words, 10, 10)).toEqual([]);
      expect(buildSubtitleCues(words, 10, 5)).toEqual([]);
    });

    it('skips blank and non-finite words', () => {
      const cues = buildSubtitleCues(
        [word('  ', 1, 1.5), word('bad', Number.NaN, 2), word('ok', 2, 2.5)],
        0,
        10,
      );

      expect(cues.map((cue) => cue.text)).toEqual(['ok']);
    });
  });

  describe('grouping words into cues', () => {
    it('starts a new cue after a long silence', () => {
      const cues = buildSubtitleCues(
        [word('hello', 0, 0.5), word('again', 2, 2.5)],
        0,
        10,
      );

      expect(cues.map((cue) => cue.text)).toEqual(['hello', 'again']);
    });

    it('does not split on a short pause', () => {
      const cues = buildSubtitleCues(
        [word('hello', 0, 0.5), word('again', 1, 1.5)],
        0,
        10,
      );

      expect(cues).toHaveLength(1);
    });

    it('splits after a sentence end once the cue is long enough', () => {
      const cues = buildSubtitleCues(
        run(['Hello', 'there', 'my', 'friend.', 'How', 'are', 'you'], 0, 0.3),
        0,
        10,
      );

      expect(cues.map((cue) => cue.text)).toEqual([
        'Hello there my friend.',
        'How are you',
      ]);
    });

    it('keeps a very short sentence in the next cue', () => {
      const cues = buildSubtitleCues(
        run(['Yes.', 'I', 'think', 'so'], 0, 0.3),
        0,
        10,
      );

      expect(cues.map((cue) => cue.text)).toEqual(['Yes. I think so']);
    });

    it('splits on the Arabic question mark', () => {
      const cues = buildSubtitleCues(
        run(['هل', 'تعرف', 'كيف', 'تبدأ؟', 'ابدأ', 'الآن'], 0, 0.3),
        0,
        10,
      );

      expect(cues.map((cue) => cue.text)).toEqual([
        'هل تعرف كيف تبدأ؟',
        'ابدأ الآن',
      ]);
    });

    it('keeps Arabic words in spoken order with single spaces', () => {
      const cues = buildSubtitleCues(
        [word(' مرحبا ', 5, 5.4), word('بكم', 5.5, 5.9)],
        5,
        15,
      );

      expect(cues[0].text).toBe('مرحبا بكم');
      expect(cues[0].startSec).toBe(0);
      expect(cues[0].endSec).toBe(0.9);
    });

    it('splits at a comma once the cue is mostly full', () => {
      const cues = buildSubtitleCues(
        run(['aaaaaaa', 'bbbbbbb', 'ccccccc,', 'ddd'], 0, 0.3),
        0,
        10,
        { maxCharsPerCue: 30 },
      );

      // "aaaaaaa bbbbbbb ccccccc," is 24 characters, 80% of the limit.
      expect(cues.map((cue) => cue.text)).toEqual([
        'aaaaaaa bbbbbbb ccccccc,',
        'ddd',
      ]);
    });

    it('never exceeds the character limit', () => {
      const cues = buildSubtitleCues(
        run(Array<string>(10).fill('aaaaa'), 0, 0.2),
        0,
        10,
      );

      expect(cues.map((cue) => cue.text.split(' ').length)).toEqual([6, 4]);
      for (const cue of cues) {
        expect(cue.text.length).toBeLessThanOrEqual(36);
      }
    });

    it('never exceeds the word limit', () => {
      const cues = buildSubtitleCues(
        run(Array<string>(10).fill('a'), 0, 0.2),
        0,
        10,
      );

      expect(cues.map((cue) => cue.text.split(' ').length)).toEqual([7, 3]);
    });

    it('never exceeds the cue duration limit', () => {
      const cues = buildSubtitleCues(
        run(Array<string>(6).fill('ab'), 0, 1),
        0,
        10,
      );

      expect(cues.map((cue) => [cue.startSec, cue.endSec])).toEqual([
        [0, 4],
        [4, 6],
      ]);
    });

    it('gives a single very long word its own cue', () => {
      const long = 'x'.repeat(50);
      const cues = buildSubtitleCues(
        [word('hi', 0, 0.4), word(long, 0.5, 1), word('bye', 1.1, 1.5)],
        0,
        10,
      );

      expect(cues.map((cue) => cue.text)).toEqual(['hi', long, 'bye']);
    });
  });

  describe('cue separation', () => {
    it('trims the earlier cue when word timings overlap', () => {
      const cues = buildSubtitleCues(
        [word('a', 0, 1.05), word('b', 1, 2)],
        0,
        10,
        { maxWordsPerCue: 1 },
      );

      expect(cues.map((cue) => [cue.startSec, cue.endSec])).toEqual([
        [0, 1],
        [1, 2],
      ]);
    });

    it('merges cues that would start at the same instant', () => {
      const cues = buildSubtitleCues(
        [word('a', 1, 1.2), word('b', 1, 1.5)],
        0,
        10,
        { maxWordsPerCue: 1 },
      );

      expect(cues).toEqual([
        { index: 1, startSec: 1, endSec: 1.5, text: 'a b' },
      ]);
    });

    it('never produces overlapping or unordered cues', () => {
      const words = run(
        ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'],
        0,
        0.5,
      ).map((item, position) =>
        // Every word overlaps its neighbour by 40 ms.
        word(item.text, item.startSec, item.endSec + 0.04 * (position % 2)),
      );

      const cues = buildSubtitleCues(words, 0, 10, { maxWordsPerCue: 2 });

      for (let position = 1; position < cues.length; position++) {
        expect(cues[position].startSec).toBeGreaterThanOrEqual(
          cues[position - 1].endSec,
        );
        expect(cues[position].index).toBe(position + 1);
      }
    });
  });

  describe('minimum display time', () => {
    it('holds a very short cue on screen when there is room', () => {
      const cues = buildSubtitleCues([word('hi', 1, 1.1)], 0, 10);

      expect(cues[0].startSec).toBe(1);
      expect(cues[0].endSec).toBe(1.4);
    });

    it('does not extend a short cue into the next one', () => {
      const cues = buildSubtitleCues(
        [word('a', 1, 1.1), word('b', 1.2, 2)],
        0,
        10,
        { maxWordsPerCue: 1 },
      );

      expect(cues[0].endSec).toBe(1.2);
      expect(cues[1].startSec).toBe(1.2);
    });

    it('does not extend a short cue past the end of the clip', () => {
      const cues = buildSubtitleCues([word('end', 9.7, 10.2)], 0, 10);

      expect(cues[0].endSec).toBe(10);
    });
  });
});

describe('estimateWordTimings', () => {
  it('spreads words over the segment in proportion to their length', () => {
    const words = estimateWordTimings({
      startSec: 10,
      endSec: 20,
      text: 'aa bbbb cc',
    });

    expect(words.map((item) => item.text)).toEqual(['aa', 'bbbb', 'cc']);
    expect(words[0].startSec).toBe(10);
    expect(words[2].endSec).toBe(20);
    expect(words.every((item) => item.estimated)).toBe(true);
    // Weights are 3, 5 and 3 out of 11.
    expect(words[0].endSec - words[0].startSec).toBeCloseTo(30 / 11, 6);
    expect(words[1].endSec - words[1].startSec).toBeCloseTo(50 / 11, 6);
    // Words are contiguous.
    expect(words[1].startSec).toBe(words[0].endSec);
    expect(words[2].startSec).toBe(words[1].endSec);
  });

  it('returns nothing for empty text or an empty range', () => {
    expect(estimateWordTimings({ startSec: 1, endSec: 5, text: '  ' })).toEqual(
      [],
    );
    expect(estimateWordTimings({ startSec: 5, endSec: 5, text: 'hi' })).toEqual(
      [],
    );
  });
});

describe('buildSubtitleCues in word mode', () => {
  it('shows one word per cue', () => {
    const cues = buildSubtitleCues(
      run(['one', 'two', 'three'], 0, 0.4),
      0,
      10,
      {},
      'WORD',
    );

    expect(cues.map((cue) => cue.text)).toEqual(['one', 'two', 'three']);
    expect(cues.map((cue) => cue.index)).toEqual([1, 2, 3]);
  });

  it('keeps a word on screen until the next one starts when the speaker does not pause', () => {
    const cues = buildSubtitleCues(
      [word('one', 0, 0.3), word('two', 0.5, 0.8), word('three', 3, 3.3)],
      0,
      10,
      {},
      'WORD',
    );

    expect(cues[0]).toMatchObject({ startSec: 0, endSec: 0.5 });
    // A real pause ends the word when it was spoken.
    expect(cues[1]).toMatchObject({ startSec: 0.5, endSec: 0.8 });
    expect(cues[2]).toMatchObject({ startSec: 3, endSec: 3.3 });
  });

  it('never overlaps cues and stays inside the clip', () => {
    const cues = buildSubtitleCues(
      run(['a', 'b', 'c', 'd', 'e'], 4, 0.05),
      5,
      20,
      {},
      'WORD',
    );

    cues.forEach((cue, position) => {
      expect(cue.startSec).toBeGreaterThanOrEqual(0);
      expect(cue.endSec).toBeLessThanOrEqual(15);
      if (position > 0) {
        expect(cue.startSec).toBeGreaterThanOrEqual(cues[position - 1].endSec);
      }
    });
  });

  it('still groups words into phrases by default', () => {
    const cues = buildSubtitleCues(run(['one', 'two', 'three'], 0, 0.4), 0, 10);

    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('one two three');
  });
});
