import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.schema';
import {
  ClipPlannerService,
  type CutPoint,
  type PlannerTranscriptSegment,
} from '../../../src/segmentation/clip-planner.service';

function createPlanner(
  values: Partial<
    Record<
      | 'CLIP_MAX_DURATION_SEC'
      | 'AI_CLIP_MIN_DURATION_SEC'
      | 'AI_CLIP_MAX_DURATION_SEC',
      number
    >
  > = {},
) {
  const all = {
    CLIP_MAX_DURATION_SEC: 240,
    AI_CLIP_MIN_DURATION_SEC: 60,
    AI_CLIP_MAX_DURATION_SEC: 240,
    ...values,
  };
  const config = {
    get: (key: keyof typeof all) => all[key],
  } as unknown as ConfigService<Env, true>;
  return new ClipPlannerService(config);
}

// A podcast that speaks in 7.5 second segments with half a second of silence
// between them; every third segment ends a sentence.
function transcript(durationSec: number): PlannerTranscriptSegment[] {
  const segments: PlannerTranscriptSegment[] = [];
  for (let index = 0; index * 8 + 7.5 <= durationSec; index += 1) {
    segments.push({
      startSec: index * 8,
      endSec: index * 8 + 7.5,
      text: index % 3 === 2 ? 'a full sentence.' : 'part of a sentence',
    });
  }
  return segments;
}

function topic(title: string, startSec: number, endSec: number) {
  return { title, startSec, endSec, summary: `${title} summary` };
}

function expectCutsAt(
  clips: { startSec: number; endSec: number }[],
  cuts: CutPoint[],
  durationSec: number,
) {
  const times = new Set(cuts.map((cut) => cut.timeSec));
  for (const clip of clips) {
    if (clip.startSec !== 0) expect(times.has(clip.startSec)).toBe(true);
    if (clip.endSec !== durationSec) {
      expect(times.has(clip.endSec)).toBe(true);
    }
  }
}

describe('ClipPlannerService', () => {
  describe('buildCutPoints', () => {
    it('cuts just after the last word of a segment, inside the silence', () => {
      const planner = createPlanner();
      const cuts = planner.buildCutPoints(
        [
          { startSec: 0, endSec: 10, text: 'First sentence.' },
          { startSec: 11, endSec: 20, text: 'and then more' },
          { startSec: 20.2, endSec: 30, text: 'Done.' },
        ],
        100,
      );

      expect(cuts).toEqual([
        { timeSec: 10.3, sentenceEnd: true, gapSec: 1 },
        { timeSec: 20.1, sentenceEnd: false, gapSec: 0.2 },
        { timeSec: 30, sentenceEnd: true, gapSec: 0 },
      ]);
    });

    it('adds cuts at long pauses between words inside a segment', () => {
      const planner = createPlanner();
      const cuts = planner.buildCutPoints(
        [
          {
            startSec: 0,
            endSec: 20,
            text: 'one two',
            words: [
              { word: 'one', startSec: 5, endSec: 6 },
              { word: 'two', startSec: 8, endSec: 9 },
            ],
          },
        ],
        100,
      );

      expect(cuts).toContainEqual({
        timeSec: 6.3,
        sentenceEnd: false,
        gapSec: 2,
      });
    });

    it('treats a long silence as a sentence end when there is no punctuation', () => {
      const planner = createPlanner();
      const cuts = planner.buildCutPoints(
        [
          { startSec: 0, endSec: 10, text: 'no punctuation here' },
          { startSec: 11, endSec: 20, text: 'none here either' },
        ],
        100,
      );

      expect(cuts[0].sentenceEnd).toBe(true);
    });
  });

  describe('planFull', () => {
    it('covers the whole video with clips between one and four minutes that start and end in a pause', () => {
      const planner = createPlanner();
      const duration = 1200;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const clips = planner.planFull(
        [
          topic('A', 0, 130),
          topic('B', 130, 410),
          topic('C', 410, 700),
          topic('D', 700, 1000),
          topic('E', 1000, 1200),
        ],
        cuts,
        duration,
        'en',
      );

      expect(clips[0].startSec).toBe(0);
      expect(clips.at(-1)?.endSec).toBe(duration);
      clips.forEach((clip, index) => {
        if (index > 0) expect(clip.startSec).toBe(clips[index - 1].endSec);
        expect(clip.endSec - clip.startSec).toBeGreaterThanOrEqual(60);
        expect(clip.endSec - clip.startSec).toBeLessThanOrEqual(240);
      });
      expectCutsAt(clips, cuts, duration);
    });

    it('moves a topic edge to the closest sentence end instead of cutting mid-sentence', () => {
      const planner = createPlanner();
      const duration = 400;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const [first] = planner.planFull(
        [topic('A', 0, 203), topic('B', 203, 400)],
        cuts,
        duration,
        'en',
      );

      const cut = cuts.find((candidate) => candidate.timeSec === first.endSec);
      expect(cut?.sentenceEnd).toBe(true);
      expect(Math.abs(first.endSec - 203)).toBeLessThan(15);
    });

    it('joins a topic shorter than a minute to its neighbour', () => {
      const planner = createPlanner();
      const duration = 400;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const clips = planner.planFull(
        [
          topic('Short', 0, 30),
          topic('Medium', 30, 200),
          topic('Rest', 200, 400),
        ],
        cuts,
        duration,
        'en',
      );

      expect(clips).toHaveLength(2);
      expect(clips[0]).toMatchObject({ title: 'Medium', startSec: 0 });
      expect(clips.every((clip) => clip.endSec - clip.startSec >= 60)).toBe(
        true,
      );
    });

    it('lets a short topic borrow time from a neighbour that is too long to join it', () => {
      const planner = createPlanner();
      const duration = 400;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const clips = planner.planFull(
        [topic('Short', 0, 30), topic('Long', 30, 400)],
        cuts,
        duration,
        'en',
      );

      expect(clips).toHaveLength(3);
      expect(clips.every((clip) => clip.endSec - clip.startSec >= 60)).toBe(
        true,
      );
      expect(clips.every((clip) => clip.endSec - clip.startSec <= 240)).toBe(
        true,
      );
      expectCutsAt(clips, cuts, duration);
    });

    it('splits a topic over four minutes into parts at sentence ends', () => {
      const planner = createPlanner();
      const duration = 700;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const clips = planner.planFull(
        [topic('Long topic', 0, 700)],
        cuts,
        duration,
        'en',
      );

      expect(clips).toHaveLength(3);
      expect(clips.map((clip) => clip.title)).toEqual([
        'Long topic (Part 1)',
        'Long topic (Part 2)',
        'Long topic (Part 3)',
      ]);
      clips.forEach((clip) => {
        expect(clip.endSec - clip.startSec).toBeLessThanOrEqual(240);
        expect(clip.endSec - clip.startSec).toBeGreaterThanOrEqual(60);
      });
      expectCutsAt(clips, cuts, duration);
      const inner = cuts.filter((cut) =>
        clips.slice(0, -1).some((clip) => clip.endSec === cut.timeSec),
      );
      expect(inner.every((cut) => cut.sentenceEnd)).toBe(true);
    });

    it('names the parts in Arabic for an Arabic transcript', () => {
      const planner = createPlanner();
      const duration = 500;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const clips = planner.planFull(
        [topic('موضوع', 0, 500)],
        cuts,
        duration,
        'ar',
      );

      expect(clips.map((clip) => clip.title)).toEqual([
        'موضوع (جزء 1)',
        'موضوع (جزء 2)',
        'موضوع (جزء 3)',
      ]);
    });

    it('keeps a video shorter than the minimum as a single clip', () => {
      const planner = createPlanner();
      const cuts = planner.buildCutPoints(transcript(40), 40);

      expect(planner.planFull([topic('Tiny', 0, 40)], cuts, 40, 'en')).toEqual([
        { title: 'Tiny', startSec: 0, endSec: 40, summary: 'Tiny summary' },
      ]);
    });

    it('respects a configured maximum below the global clip limit', () => {
      const planner = createPlanner({ AI_CLIP_MAX_DURATION_SEC: 120 });
      const duration = 400;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const clips = planner.planFull(
        [topic('A', 0, 400)],
        cuts,
        duration,
        'en',
      );

      expect(clips.length).toBeGreaterThanOrEqual(4);
      clips.forEach((clip) =>
        expect(clip.endSec - clip.startSec).toBeLessThanOrEqual(120),
      );
    });

    it('never exceeds the global clip limit even if the AI maximum is higher', () => {
      const planner = createPlanner({
        CLIP_MAX_DURATION_SEC: 180,
        AI_CLIP_MAX_DURATION_SEC: 240,
      });

      expect(planner.maxSec).toBe(180);
    });
  });

  describe('planHighlights', () => {
    function moment(
      title: string,
      startSec: number,
      endSec: number,
      score: number,
    ) {
      return { ...topic(title, startSec, endSec), score };
    }

    it('keeps only the standout moments and leaves gaps between them', () => {
      const planner = createPlanner();
      const duration = 1800;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const clips = planner.planHighlights(
        [
          moment('Hook', 100, 220, 9),
          moment('Story', 600, 780, 8),
          moment('Advice', 1200, 1330, 9),
          moment('Filler', 1500, 1600, 3),
        ],
        cuts,
        duration,
        'en',
      );

      expect(clips.map((clip) => clip.title)).toEqual([
        'Hook',
        'Story',
        'Advice',
      ]);
      clips.forEach((clip, index) => {
        if (index > 0) {
          expect(clip.startSec).toBeGreaterThan(clips[index - 1].endSec);
        }
        expect(clip.endSec - clip.startSec).toBeGreaterThanOrEqual(60);
        expect(clip.endSec - clip.startSec).toBeLessThanOrEqual(240);
      });
      expectCutsAt(clips, cuts, duration);
    });

    it('extends a moment shorter than a minute up to a minute at a pause', () => {
      const planner = createPlanner();
      const duration = 900;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const [clip] = planner.planHighlights(
        [moment('Quick one', 200, 230, 9)],
        cuts,
        duration,
        'en',
      );

      expect(clip.endSec - clip.startSec).toBeGreaterThanOrEqual(60);
      expect(clip.endSec - clip.startSec).toBeLessThan(90);
      expectCutsAt([clip], cuts, duration);
    });

    it('drops the weaker of two overlapping moments from neighbouring windows', () => {
      const planner = createPlanner();
      const duration = 900;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const clips = planner.planHighlights(
        [
          moment('Same idea', 200, 300, 7),
          moment('Same idea again', 210, 310, 9),
        ],
        cuts,
        duration,
        'en',
      );

      expect(clips).toHaveLength(1);
      expect(clips[0].title).toBe('Same idea again');
    });

    it('splits a moment longer than four minutes into parts', () => {
      const planner = createPlanner();
      const duration = 900;
      const cuts = planner.buildCutPoints(transcript(duration), duration);

      const clips = planner.planHighlights(
        [moment('Deep dive', 100, 600, 10)],
        cuts,
        duration,
        'en',
      );

      expect(clips.length).toBeGreaterThanOrEqual(3);
      expect(clips[0].title).toBe('Deep dive (Part 1)');
      clips.forEach((clip) =>
        expect(clip.endSec - clip.startSec).toBeLessThanOrEqual(240),
      );
    });

    it('limits how many moments it returns for a short episode', () => {
      const planner = createPlanner();
      const duration = 900;
      const cuts = planner.buildCutPoints(transcript(duration), duration);
      const many = Array.from({ length: 8 }, (_, index) =>
        moment(`Moment ${index}`, index * 100 + 10, index * 100 + 90, 9),
      );

      const clips = planner.planHighlights(many, cuts, duration, 'en');

      expect(clips).toHaveLength(3);
    });

    it('returns nothing when the model found nothing', () => {
      const planner = createPlanner();

      expect(planner.planHighlights([], [], 600, 'en')).toEqual([]);
    });
  });
});
