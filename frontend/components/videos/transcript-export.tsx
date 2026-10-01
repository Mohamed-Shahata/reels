'use client';

import type { Transcript } from '@/lib/api';
import {
  buildSubtitleFile,
  buildTranscriptText,
  downloadTextFile,
} from '@/lib/clip-insights';

interface TranscriptExportProps {
  transcript: Transcript | null;
  transcribing: boolean;
  onTranscribe: () => void;
}

const buttonClass =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d5e2dc] bg-white px-3 text-xs font-bold text-[#263532] hover:border-[#0f766e] hover:bg-[#e4f3ef] hover:text-[#0f766e]';

function DownloadGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="13"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="13"
    >
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" />
    </svg>
  );
}

/** Download buttons for the transcript; nothing is written on the video. */
export function TranscriptExport({
  transcript,
  transcribing,
  onTranscribe,
}: TranscriptExportProps) {
  const segments = transcript?.segments ?? [];

  if (segments.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e2eae6] bg-white px-5 py-3.5 text-sm shadow-[var(--shadow-surface)]">
        <span className="text-[#5d6d68]">
          No transcript yet. Extract it to get subtitles and AI clips.
        </span>
        <button
          className="h-8 rounded-lg bg-[#0f766e] px-3 font-semibold text-white hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
          disabled={transcribing}
          onClick={onTranscribe}
          type="button"
        >
          {transcribing ? 'Processing audio...' : 'Extract Transcript'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e2eae6] bg-white px-5 py-3.5 text-sm shadow-[var(--shadow-surface)]">
      <span>
        Transcript{' '}
        <strong className="rounded-md bg-[#e4f3ef] px-1.5 py-0.5 uppercase text-[#0f766e]">
          {transcript?.language}
        </strong>
        <span className="text-[#5d6d68]"> · download</span>
      </span>
      <div className="flex gap-2">
        {(['srt', 'vtt'] as const).map((format) => (
          <button
            aria-label={`Download transcript ${format.toUpperCase()}`}
            className={buttonClass}
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
            <DownloadGlyph />
            {format.toUpperCase()}
          </button>
        ))}
        <button
          aria-label="Download transcript TXT"
          className={buttonClass}
          onClick={() =>
            downloadTextFile(
              'transcript.txt',
              buildTranscriptText(segments),
              'text/plain',
            )
          }
          type="button"
        >
          <DownloadGlyph />
          TXT
        </button>
      </div>
    </div>
  );
}
