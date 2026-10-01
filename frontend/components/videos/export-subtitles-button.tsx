'use client';

import { useState } from 'react';
import {
  api,
  getApiErrorMessage,
  type Clip,
  type SubtitleDisplayMode,
  type SubtitleEdit,
} from '@/lib/api';
import { downloadTextFile } from '@/lib/clip-insights';
import {
  buildClipSubtitleFile,
  subtitleFileName,
  SUBTITLE_EXPORT_MIME,
  type SubtitleExportFormat,
} from '@/lib/subtitle-export';

interface ExportSubtitlesButtonProps {
  clip: Clip;
  /** Same cue layout the burned-in video uses (phrases or word by word). */
  displayMode?: SubtitleDisplayMode;
  /** Edited subtitle text, so the file matches the video. */
  edits?: SubtitleEdit[];
}

const buttonClass =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d5e2dc] bg-white px-3 text-xs font-semibold text-[#3f4f4a] hover:border-[#0f766e] hover:bg-[#e4f3ef] hover:text-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50';

const FORMATS: SubtitleExportFormat[] = ['srt', 'vtt', 'txt'];

function DownloadGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" />
    </svg>
  );
}

/** Downloads the subtitles of one clip as a file; the video is not touched. */
export function ExportSubtitlesButton({
  clip,
  displayMode = 'PHRASE',
  edits = [],
}: ExportSubtitlesButtonProps) {
  const [busy, setBusy] = useState<SubtitleExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportAs(format: SubtitleExportFormat) {
    setBusy(format);
    setError(null);
    try {
      const subtitles = await api.getClipSubtitles(clip.id, displayMode);
      const content = buildClipSubtitleFile(subtitles.cues, edits, format);
      if (!content) {
        setError('This clip has no subtitles to export.');
        return;
      }
      downloadTextFile(
        subtitleFileName(clip, format),
        content,
        SUBTITLE_EXPORT_MIME[format],
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, 'Subtitles could not be exported.'),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 border-t border-[#eef2f0] pt-3">
      <span className="text-xs font-semibold">Export subtitles</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {FORMATS.map((format) => (
          <button
            aria-label={`Export subtitles as ${format.toUpperCase()}`}
            className={buttonClass}
            disabled={busy !== null}
            key={format}
            onClick={() => void exportAs(format)}
            type="button"
          >
            <DownloadGlyph />
            {busy === format ? 'Exporting' : format.toUpperCase()}
          </button>
        ))}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-[#a13d3d]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
