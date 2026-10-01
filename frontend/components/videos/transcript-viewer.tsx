'use client';

import type { Transcript, TranscriptSegment } from '@/lib/api';
import {
  buildSubtitleFile,
  downloadTextFile,
  searchSegments,
} from '@/lib/clip-insights';
import { useEffect, useMemo, useRef, useState } from 'react';

interface TranscriptViewerProps {
  transcript: Transcript | null;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onCreateClip?: (segment: TranscriptSegment) => void;
  isLoading?: boolean;
  onTranscribe?: () => void;
  isTranscribing?: boolean;
}

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${(rounded % 60).toString().padStart(2, '0')}`;
}

export function TranscriptViewer({
  transcript,
  currentTime,
  onSeek,
  onCreateClip,
  isLoading = false,
  onTranscribe,
  isTranscribing = false,
}: TranscriptViewerProps) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [speaker, setSpeaker] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);

  const segments = useMemo(
    () => transcript?.segments ?? [],
    [transcript?.segments],
  );
  const speakers = useMemo(
    () =>
      Array.from(
        new Set(segments.map((s) => s.speaker).filter((s): s is string => !!s)),
      ),
    [segments],
  );
  const visible = useMemo(
    () =>
      searchSegments(
        speaker === 'all'
          ? segments
          : segments.filter((s) => s.speaker === speaker),
        query,
      ),
    [segments, speaker, query],
  );
  const activeId = segments.find(
    (s) => currentTime >= s.startSec && currentTime < s.endSec,
  )?.id;

  useEffect(() => {
    if (!query && autoScroll) {
      activeRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeId, query, autoScroll]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl bg-white p-6 text-sm text-[#5f6e69]">
        Loading transcript...
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl bg-white p-6 text-center text-sm text-[#5f6e69]">
        <p className="font-medium text-[#172321]">
          No transcript available yet
        </p>
        <p className="mt-1 text-xs">
          Extract transcript from audio using Groq Whisper AI.
        </p>
        {onTranscribe ? (
          <button
            className="mt-4 rounded-lg bg-[#0f766e] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
            disabled={isTranscribing}
            onClick={onTranscribe}
            type="button"
          >
            {isTranscribing ? 'Processing audio...' : 'Extract Transcript'}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-2xl bg-white">
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Transcript</h3>
          <span className="rounded bg-[#e6f4f1] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#0f766e]">
            {transcript?.language}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            aria-pressed={autoScroll}
            className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
              autoScroll
                ? 'border-[#0f766e] bg-[#e6f4f1] text-[#0f766e]'
                : 'border-[#d8e1dc] hover:border-[#0f766e]'
            }`}
            onClick={() => setAutoScroll((current) => !current)}
            type="button"
          >
            Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
          </button>
          {(['srt', 'vtt'] as const).map((format) => (
            <button
              className="rounded-md border border-[#d8e1dc] px-2 py-1 text-[11px] font-medium hover:border-[#0f766e] hover:text-[#0f766e]"
              key={format}
              onClick={() =>
                downloadTextFile(
                  `transcript.${format}`,
                  buildSubtitleFile(segments, format),
                  format === 'srt' ? 'application/x-subrip' : 'text/vtt',
                )
              }
              type="button"
            >
              Export {format.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-3">
        <input
          aria-label="Search transcript"
          className="h-9 w-full rounded-lg border border-[#d8e1dc] bg-[#f6f8f7] px-3 text-sm outline-none focus:border-[#0f766e]"
          dir="auto"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search spoken words..."
          value={query}
        />
        {query.trim() ? (
          <p className="mt-1 text-[11px] text-[#5f6e69]" role="status">
            {visible.length} of {segments.length} segments match
          </p>
        ) : null}
        {speakers.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['all', ...speakers].map((item) => (
              <button
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  speaker === item
                    ? 'bg-[#0f766e] text-white'
                    : 'bg-[#e6f4f1] text-[#0f766e]'
                }`}
                key={item}
                onClick={() => setSpeaker(item)}
                type="button"
              >
                {item === 'all' ? `All Speakers (${speakers.length})` : item}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-3 max-h-[42rem] space-y-2 overflow-y-auto px-3 pb-3">
        {visible.length === 0 ? (
          <p className="p-4 text-center text-xs text-[#5f6e69]">
            No matching phrases.
          </p>
        ) : null}
        {visible.map((segment) => {
          const active = segment.id === activeId;
          return (
            <div
              className={`rounded-xl border p-3 ${
                active
                  ? 'border-[#0f766e]/40 bg-[#e6f4f1]'
                  : 'border-transparent bg-[#f6f8f7]'
              }`}
              key={segment.id}
              ref={active ? activeRef : null}
            >
              <div className="flex items-center justify-between font-mono text-[10px] text-[#5f6e69]">
                <span>
                  {formatTime(segment.startSec)} - {formatTime(segment.endSec)}
                </span>
                {segment.speaker ? <span>{segment.speaker}</span> : null}
              </div>
              <p
                className="mt-1.5 text-[15px] leading-7"
                dir="auto"
                style={{ fontFamily: 'var(--font-cairo), sans-serif' }}
              >
                {segment.text}
              </p>
              {active ? (
                <div className="mt-2 flex gap-2">
                  <button
                    className="rounded-md border border-[#a9bab3] bg-white px-2 py-1 text-[11px] font-medium"
                    onClick={() => onSeek(segment.startSec)}
                    type="button"
                  >
                    Play from here
                  </button>
                  {onCreateClip ? (
                    <button
                      className="rounded-md bg-[#0f766e] px-2 py-1 text-[11px] font-semibold text-white"
                      onClick={() => onCreateClip(segment)}
                      type="button"
                    >
                      Create clip
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  className="mt-1 text-[11px] font-medium text-[#0f766e] underline"
                  onClick={() => onSeek(segment.startSec)}
                  type="button"
                >
                  Play from here
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
