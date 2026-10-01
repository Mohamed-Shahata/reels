'use client';

import { useCallback, useState } from 'react';
import {
  api,
  getApiErrorMessage,
  type Clip,
  type ClipSubtitles,
  type SubtitleDisplayMode,
  type SubtitleEdit,
} from '@/lib/api';
import {
  countHiddenCues,
  draftText,
  draftsToEdits,
  editsToDrafts,
  formatCueTime,
  MAX_SUBTITLE_EDIT_TEXT_LENGTH,
  sameEdits,
  type CueDrafts,
} from '@/lib/subtitle-edits';

interface SubtitleTextEditorProps {
  clip: Clip;
  edits: SubtitleEdit[];
  /** Cue layout to edit; word-by-word has one cue per word. */
  displayMode?: SubtitleDisplayMode;
  onChange: (edits: SubtitleEdit[]) => void;
}

const buttonClass =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d5e2dc] bg-white px-3 text-xs font-semibold text-[#3f4f4a] hover:border-[#0f766e] hover:bg-[#e4f3ef] hover:text-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50';

function PencilIcon() {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

export function SubtitleTextEditor({
  clip,
  edits,
  displayMode = 'PHRASE',
  onChange,
}: SubtitleTextEditorProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<ClipSubtitles | null>(null);
  const [drafts, setDrafts] = useState<CueDrafts>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getClipSubtitles(clip.id, displayMode);
      setSubtitles(next);
      setDrafts(editsToDrafts(edits));
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, 'Subtitles could not be loaded.'),
      );
    } finally {
      setLoading(false);
    }
  }, [clip.id, edits, displayMode]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!subtitles && !loading) void load();
  }

  function changeDraft(index: number, text: string) {
    setDrafts((current) => ({ ...current, [index]: text }));
  }

  const pending = subtitles ? draftsToEdits(subtitles.cues, drafts) : [];
  const dirty = subtitles !== null && !sameEdits(pending, edits);
  const hiddenCount = countHiddenCues(edits);

  return (
    <div className="mt-3 border-t border-[#eef2f0] pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">Subtitle text</span>
        {edits.length > 0 ? (
          <span
            className="rounded-full bg-[#e4f3ef] px-2 py-0.5 text-xs font-semibold text-[#0f766e]"
            role="status"
          >
            {edits.length} edited
          </span>
        ) : null}
      </div>
      <button
        aria-expanded={open}
        className={`${buttonClass} mt-2`}
        onClick={toggle}
        type="button"
      >
        <PencilIcon />
        {open ? 'Hide subtitle editor' : 'Edit subtitle text'}
      </button>
      {open ? (
        <div className="mt-3">
          {loading ? (
            <p className="text-xs text-[#5d6d68]" role="status">
              Loading subtitles...
            </p>
          ) : null}
          {error ? (
            <div role="alert">
              <p className="text-xs text-[#a13d3d]">{error}</p>
              <button
                className={`${buttonClass} mt-2`}
                onClick={() => void load()}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : null}
          {subtitles && subtitles.cues.length === 0 ? (
            <p className="text-xs text-[#5d6d68]">
              This clip has no speech to subtitle.
            </p>
          ) : null}
          {subtitles && subtitles.cues.length > 0 ? (
            <>
              {subtitles.timing === 'ESTIMATED' ||
              subtitles.timing === 'MIXED' ? (
                <p className="mb-2 text-xs text-[#8a5a00]">
                  Timing for this clip is estimated, so lines may appear a
                  little early or late. Transcribe the video again for exact
                  timing.
                </p>
              ) : null}
              <p className="mb-2 text-xs text-[#5d6d68]">
                Edit the text of a line, or clear it to hide the line. Timing
                stays the same.
              </p>
              <ol className="grid max-h-80 gap-2 overflow-y-auto pr-1">
                {subtitles.cues.map((cue) => (
                  <li key={cue.index}>
                    <label
                      className="block text-xs text-[#5d6d68]"
                      htmlFor={`cue-${clip.id}-${cue.index}`}
                    >
                      {formatCueTime(cue.startSec)} to{' '}
                      {formatCueTime(cue.endSec)}
                    </label>
                    <textarea
                      aria-label={`Subtitle ${cue.index} text`}
                      className="mt-1 w-full rounded-lg border border-[#d5e2dc] bg-white px-2 py-1 text-sm focus:border-[#0f766e] focus:outline-none"
                      dir="auto"
                      id={`cue-${clip.id}-${cue.index}`}
                      maxLength={MAX_SUBTITLE_EDIT_TEXT_LENGTH}
                      onChange={(event) =>
                        changeDraft(cue.index, event.target.value)
                      }
                      rows={2}
                      value={draftText(cue, drafts)}
                    />
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="h-8 rounded-lg bg-[#0f766e] px-3 text-xs font-semibold text-white hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
                  disabled={!dirty}
                  onClick={() => onChange(pending)}
                  type="button"
                >
                  Apply text changes
                </button>
                {dirty ? (
                  <button
                    className={buttonClass}
                    onClick={() => setDrafts(editsToDrafts(edits))}
                    type="button"
                  >
                    Discard changes
                  </button>
                ) : null}
                {edits.length > 0 || pending.length > 0 ? (
                  <button
                    className={buttonClass}
                    onClick={() => {
                      setDrafts({});
                      onChange([]);
                    }}
                    type="button"
                  >
                    Reset to transcript
                  </button>
                ) : null}
              </div>
              {edits.length > 0 ? (
                <p className="mt-2 text-xs text-[#5d6d68]">
                  {hiddenCount > 0
                    ? `${edits.length} edited, ${hiddenCount} hidden. `
                    : ''}
                  Render this clip again to use the edited text.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
