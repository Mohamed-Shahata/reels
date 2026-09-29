import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.schema';
import { TranscriptWindowingService } from '../../../src/segmentation/transcript-windowing.service';

function createService(maxCharacters = 120): TranscriptWindowingService {
  const values = {
    SEGMENTATION_WINDOW_MAX_CHARS: maxCharacters,
    SEGMENTATION_WINDOW_OVERLAP_SEC: 15,
  };
  return new TranscriptWindowingService({
    get: (key: keyof typeof values) => values[key],
  } as unknown as ConfigService<Env, true>);
}

function segment(startSec: number, text: string, durationSec = 10) {
  return { startSec, endSec: startSec + durationSec, text };
}

describe('TranscriptWindowingService', () => {
  it('splits ordered segments into size-bounded windows with overlap', () => {
    const service = createService();
    const windows = service.createWindows([
      segment(0, 'a'.repeat(40)),
      segment(10, 'b'.repeat(40)),
      segment(20, 'c'.repeat(40)),
      segment(30, 'd'.repeat(40)),
    ]);

    expect(windows).toEqual([
      expect.objectContaining({ startSec: 0, endSec: 30, characterCount: 120 }),
      expect.objectContaining({
        startSec: 10,
        endSec: 40,
        characterCount: 120,
      }),
    ]);
    expect(windows[1].segments[0].text).toBe('b'.repeat(40));
    expect(windows.every((window) => window.characterCount <= 120)).toBe(true);
  });

  it('fits a one-hour transcript into conservative LLM-sized windows', () => {
    const service = createService(12_000);
    const segments = Array.from({ length: 720 }, (_, index) =>
      segment(index * 5, `segment ${index} ${'word '.repeat(30)}`, 5),
    );

    const windows = service.createWindows(segments);

    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].startSec).toBe(0);
    expect(windows.at(-1)?.endSec).toBe(3600);
    expect(
      windows.every(
        (window) =>
          window.characterCount <= 12_000 && window.estimatedTokens <= 6_000,
      ),
    ).toBe(true);
    expect(
      segments.every((source) =>
        windows.some((window) =>
          window.segments.some(
            (segment) => segment.startSec === source.startSec,
          ),
        ),
      ),
    ).toBe(true);
  });

  it('silently filters invalid segments and rejects unordered or oversized ones', () => {
    const service = createService(20);

    expect(service.createWindows([segment(0, '')])).toEqual([]);
    expect(
      service.createWindows([segment(0, ''), segment(5, 'valid', 5)]),
    ).toEqual([expect.objectContaining({ startSec: 5, endSec: 10 })]);
    expect(() =>
      service.createWindows([segment(10, 'valid'), segment(0, 'earlier')]),
    ).toThrow(/ordered/);
    expect(() => service.createWindows([segment(0, 'x'.repeat(21))])).toThrow(
      /exceeds/,
    );
  });
});
