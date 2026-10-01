import type { Clip, Transcript } from '@/lib/api';
import { useTrimDraft } from '@/lib/use-trim-draft';
import { act, renderHook } from '@testing-library/react';

const transcript: Transcript = {
  id: 't',
  videoId: 'v',
  language: 'ar',
  segments: [
    { id: 'a', startSec: 10, endSec: 20.4, text: '  first sentence  ' },
    { id: 'b', startSec: 20.4, endSec: 41, text: 'second sentence' },
  ],
};

const clip = {
  id: 'clip-1',
  title: 'Loaded clip',
  startSec: 100,
  endSec: 130,
  source: 'AI',
} as Clip;

describe('useTrimDraft', () => {
  it('starts with a 30 second default range', () => {
    const { result } = renderHook(() => useTrimDraft(null, 600));

    expect(result.current.range).toEqual({ startSec: 0, endSec: 30 });
    expect(result.current.startText).toBe('00:00');
    expect(result.current.endText).toBe('00:30');
    expect(result.current.activeClipId).toBeNull();
    expect(result.current.checks.startBeforeEnd).toBe(true);
  });

  it('loads a clip into the range, title and active clip', () => {
    const { result } = renderHook(() => useTrimDraft(null, 600));

    act(() => result.current.loadClip(clip));

    expect(result.current.range).toEqual({ startSec: 100, endSec: 130 });
    expect(result.current.startText).toBe('01:40');
    expect(result.current.endText).toBe('02:10');
    expect(result.current.title).toBe('Loaded clip');
    expect(result.current.activeClipId).toBe('clip-1');
  });

  it('starts a new clip from a transcript sentence', () => {
    const { result } = renderHook(() => useTrimDraft(transcript, 600));

    act(() => result.current.loadClip(clip));
    act(() => result.current.loadSegment(transcript.segments[0]));

    // Start is floored and end is rounded up so the last word is not cut.
    expect(result.current.range).toEqual({ startSec: 10, endSec: 21 });
    expect(result.current.title).toBe('first sentence');
    expect(result.current.activeClipId).toBeNull();
  });

  it('keeps a sentence end inside the episode', () => {
    const { result } = renderHook(() => useTrimDraft(transcript, 20));

    act(() => result.current.loadSegment(transcript.segments[0]));

    expect(result.current.range.endSec).toBe(20);
  });

  it('snaps applied ranges to sentences only while snapping is on', () => {
    const { result } = renderHook(() => useTrimDraft(transcript, 600));

    act(() => result.current.applyRange({ startSec: 11, endSec: 40 }));
    expect(result.current.range).toEqual({ startSec: 10, endSec: 41 });

    act(() => result.current.toggleSnapping());
    act(() => result.current.applyRange({ startSec: 11, endSec: 40 }));
    expect(result.current.range).toEqual({ startSec: 11, endSec: 40 });
  });

  it('updates the range from typed timecodes and ignores malformed ones', () => {
    const { result } = renderHook(() => useTrimDraft(null, 600));

    act(() => result.current.commitText('start', '01:05'));
    expect(result.current.range.startSec).toBe(65);

    act(() => result.current.commitText('end', '1:99'));
    expect(result.current.endText).toBe('1:99');
    expect(result.current.range.endSec).toBe(30);
    expect(result.current.checks.startBeforeEnd).toBe(false);
  });
});
