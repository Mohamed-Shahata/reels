import {
  activeShortCaption,
  activeWordCaption,
  splitSegmentCaptions,
} from '@/lib/short-captions';
import type { Transcript } from '@/lib/api';

const long =
  'كلمتني انت مرة اللي فاتت وقلتلي على ان من اهم المهارات اللي انت شايف ان الشخص لازم يكون منامي المهارة دي عنده';

describe('short captions', () => {
  it('splits a long sentence into short, ordered lines', () => {
    const captions = splitSegmentCaptions({
      startSec: 10,
      endSec: 20,
      text: long,
    });

    expect(captions.length).toBeGreaterThan(2);
    for (const caption of captions) {
      expect(caption.text.split(' ').length).toBeLessThanOrEqual(6);
      expect(caption.text.length).toBeLessThanOrEqual(34);
    }
    expect(captions[0].startSec).toBe(10);
    expect(captions[captions.length - 1].endSec).toBe(20);
    expect(captions.map((caption) => caption.text).join(' ')).toBe(long);
  });

  it('shows only the line under the playhead', () => {
    const transcript: Transcript = {
      id: 't',
      videoId: 'v',
      language: 'ar',
      segments: [{ id: 's', startSec: 0, endSec: 10, text: long }],
    };

    const first = activeShortCaption(transcript, 0.1);
    const later = activeShortCaption(transcript, 9.5);

    expect(first).not.toBe(later);
    expect(long.startsWith(first ?? '')).toBe(true);
    expect(activeShortCaption(transcript, 11)).toBeNull();
  });

  it('shows one word at a time in word mode, in reading order', () => {
    const transcript: Transcript = {
      id: 't',
      videoId: 'v',
      language: 'ar',
      segments: [{ id: 's', startSec: 0, endSec: 10, text: long }],
    };
    const words = long.split(' ');
    const seen: string[] = [];
    for (let time = 0.05; time < 10; time += 0.05) {
      const word = activeWordCaption(transcript, time);
      expect(word).not.toBeNull();
      expect(word).not.toContain(' ');
      if (seen[seen.length - 1] !== word) seen.push(word as string);
    }

    expect(seen).toEqual(words);
    expect(activeWordCaption(transcript, 11)).toBeNull();
    expect(activeWordCaption(null, 1)).toBeNull();
  });
});
