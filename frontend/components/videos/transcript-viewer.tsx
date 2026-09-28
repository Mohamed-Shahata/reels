'use client';

import { useRef, useEffect } from 'react';
import type { Transcript, TranscriptSegment } from '@/lib/api';

interface TranscriptViewerProps {
  transcript: Transcript | null;
  currentTime: number;
  onSeek: (seconds: number) => void;
  isLoading?: boolean;
  onTranscribe?: () => void;
  isTranscribing?: boolean;
}

export function TranscriptViewer({
  transcript,
  currentTime,
  onSeek,
  isLoading = false,
  onTranscribe,
  isTranscribing = false,
}: TranscriptViewerProps) {
  const activeSegmentRef = useRef<HTMLButtonElement | null>(null);

  const activeSegmentIndex =
    transcript?.segments && transcript.segments.length > 0
      ? transcript.segments.findIndex(
          (s: TranscriptSegment) =>
            currentTime >= s.startSec && currentTime < s.endSec,
        )
      : -1;

  useEffect(() => {
    if (activeSegmentRef.current) {
      activeSegmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeSegmentIndex]);

  function formatTime(seconds: number): string {
    const rounded = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return `${minutes}:${remainder.toString().padStart(2, '0')}`;
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-sm border border-[#d8e1dc] bg-white p-6 text-sm text-[#5f6e69]">
        Loading transcript...
      </div>
    );
  }

  if (!transcript || !transcript.segments || transcript.segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-sm border border-[#d8e1dc] bg-white p-6 text-center text-sm text-[#5f6e69]">
        <p className="font-medium text-[#172321]">
          No transcript available yet
        </p>
        <p className="mt-1 text-xs">
          Extract transcript from audio using Groq Whisper AI.
        </p>
        {onTranscribe ? (
          <button
            type="button"
            disabled={isTranscribing}
            onClick={onTranscribe}
            className="mt-4 rounded-sm bg-[#0f766e] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
          >
            {isTranscribing ? 'Processing audio...' : 'Extract Transcript'}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-sm border border-[#d8e1dc] bg-white">
      <div className="flex items-center justify-between border-b border-[#d8e1dc] px-4 py-3">
        <h3 className="text-sm font-semibold text-[#172321]">Transcript</h3>
        <span className="text-xs font-medium uppercase tracking-wider text-[#5f6e69]">
          {transcript.language} ({transcript.segments.length} segments)
        </span>
      </div>

      <div className="max-h-96 divide-y divide-[#f0f4f2] overflow-y-auto p-2">
        {transcript.segments.map(
          (segment: TranscriptSegment, index: number) => {
            const isActive = index === activeSegmentIndex;
            return (
              <button
                key={segment.id}
                ref={isActive ? activeSegmentRef : null}
                type="button"
                onClick={() => onSeek(segment.startSec)}
                className={`group flex w-full flex-col items-start gap-1 p-2 text-left transition-colors ${
                  isActive
                    ? 'bg-[#e6f4f1] text-[#0b615b]'
                    : 'hover:bg-[#f6f8f7] text-[#172321]'
                }`}
              >
                <span
                  className={`font-mono text-xs font-semibold ${
                    isActive
                      ? 'text-[#0f766e]'
                      : 'text-[#5f6e69] group-hover:text-[#0f766e]'
                  }`}
                >
                  {formatTime(segment.startSec)} - {formatTime(segment.endSec)}
                </span>
                <p className="text-sm leading-relaxed">{segment.text}</p>
              </button>
            );
          },
        )}
      </div>
    </div>
  );
}
