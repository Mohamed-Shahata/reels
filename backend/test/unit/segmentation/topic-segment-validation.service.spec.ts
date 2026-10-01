import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.schema';
import {
  SegmentationValidationError,
  TopicSegmentValidationService,
} from '../../../src/segmentation/topic-segment-validation.service';

function createService(): TopicSegmentValidationService {
  const values = {
    CLIP_MIN_DURATION_SEC: 5,
    CLIP_MAX_DURATION_SEC: 30,
    SEGMENTATION_VALIDATION_MAX_ATTEMPTS: 3,
  };
  return new TopicSegmentValidationService({
    get: (key: keyof typeof values) => values[key],
  } as unknown as ConfigService<Env, true>);
}

describe('TopicSegmentValidationService', () => {
  const service = createService();

  it('merges tiny topics and splits oversized topics while preserving coverage', () => {
    const segments = service.validate(
      {
        segments: [
          {
            title: 'Greeting',
            startSec: 0,
            endSec: 3,
            summary: 'A brief greeting.',
          },
          {
            title: 'Listening',
            startSec: 3,
            endSec: 83,
            summary: 'How active listening builds trust.',
          },
        ],
      },
      83,
    );

    expect(segments).toEqual([
      expect.objectContaining({
        title: 'Listening (Part 1)',
        startSec: 0,
        endSec: 27.667,
      }),
      expect.objectContaining({
        title: 'Listening (Part 2)',
        startSec: 27.667,
        endSec: 55.333,
      }),
      expect.objectContaining({
        title: 'Listening (Part 3)',
        startSec: 55.333,
        endSec: 83,
      }),
    ]);
    expect(
      segments.every((segment) => segment.endSec - segment.startSec >= 5),
    ).toBe(true);
    expect(
      segments.every((segment) => segment.endSec - segment.startSec <= 30),
    ).toBe(true);
  });

  it('accepts sub-millisecond differences when the video duration is fractional', () => {
    const segments = service.validate(
      {
        segments: [
          { title: 'A', startSec: 0, endSec: 20, summary: 'First topic.' },
          {
            title: 'B',
            startSec: 20,
            endSec: 40.03,
            summary: 'Second topic.',
          },
        ],
      },
      40.0349,
    );

    expect(segments).toHaveLength(2);
  });

  it('rejects schema violations and non-contiguous coverage', () => {
    expect(() =>
      service.validate(
        {
          segments: [
            {
              title: 'Topic',
              startSec: 0,
              endSec: 60,
              summary: 'Valid fields plus an extra one.',
              extra: true,
            },
          ],
        },
        60,
      ),
    ).toThrow(SegmentationValidationError);

    expect(() =>
      service.validate(
        {
          segments: [
            { title: 'One', startSec: 0, endSec: 20, summary: 'First.' },
            { title: 'Two', startSec: 25, endSec: 60, summary: 'Second.' },
          ],
        },
        60,
      ),
    ).toThrow(/gaps or overlaps/);
  });

  it('retries a provider response until it receives validated JSON', async () => {
    const request = jest
      .fn<Promise<unknown>, [number]>()
      .mockResolvedValueOnce({ segments: [] })
      .mockResolvedValueOnce({
        segments: [
          {
            title: 'Complete topic',
            startSec: 0,
            endSec: 30,
            summary: 'A valid segment.',
          },
        ],
      });

    await expect(service.requestValidSegments(request, 30)).resolves.toEqual([
      expect.objectContaining({
        title: 'Complete topic',
        startSec: 0,
        endSec: 30,
      }),
    ]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  describe('highlights', () => {
    const moment = {
      title: 'A sharp take',
      startSec: 120,
      endSec: 200,
      summary: 'The guest explains why most advice fails.',
      score: 8,
    };

    it('parses highlight moments with a score', () => {
      expect(service.parseHighlights({ moments: [moment] })).toEqual([moment]);
    });

    it('accepts an empty list for a window without strong moments', () => {
      expect(service.parseHighlights({ moments: [] })).toEqual([]);
    });

    it('rejects a moment without a score or with a score above ten', () => {
      const withoutScore = { ...moment, score: undefined };

      expect(() =>
        service.parseHighlights({ moments: [withoutScore] }),
      ).toThrow(SegmentationValidationError);
      expect(() =>
        service.parseHighlights({ moments: [{ ...moment, score: 11 }] }),
      ).toThrow(SegmentationValidationError);
    });

    it('retries an invalid response until it gets a valid one', async () => {
      const request = jest
        .fn()
        .mockResolvedValueOnce({ segments: [] })
        .mockResolvedValueOnce({ moments: [moment] });

      await expect(service.requestValidHighlights(request)).resolves.toEqual([
        moment,
      ]);
      expect(request).toHaveBeenCalledTimes(2);
    });
  });
});
