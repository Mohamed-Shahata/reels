'use client';

import type { Clip, ClipRender } from '@/lib/api';
import {
  getClipRenderState,
  type ClipRenderState,
  type RenderSummary,
} from '@/lib/clip-render';

interface ClipRenderControlsProps {
  clip: Clip;
  render: ClipRender | undefined;
  busy: boolean;
  burnSubtitles: boolean;
  subtitlesAvailable: boolean;
  onToggleSubtitles: (enabled: boolean) => void;
  onPreview: () => void;
  onRender: () => void;
  onRetry: (renderId: string) => void;
  onDownload: () => void;
}

const buttonClass =
  'h-8 border border-[#a9bab3] px-2 text-xs font-medium hover:border-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50';

function describeState(state: ClipRenderState): string {
  if (state.kind === 'ready') return 'Ready';
  if (state.kind === 'failed') return 'Failed';
  if (state.kind === 'active') {
    return state.queued ? 'Queued' : `Rendering ${state.progress}%`;
  }
  return 'Not rendered';
}

function badgeClass(state: ClipRenderState): string {
  if (state.kind === 'ready') return 'bg-[#dce6e1] text-[#0b615b]';
  if (state.kind === 'failed') return 'bg-[#fff2ef] text-[#c44932]';
  if (state.kind === 'active') return 'bg-[#e6f4f1] text-[#0f766e]';
  return 'bg-gray-100 text-gray-600';
}

export function ClipRenderControls({
  clip,
  render,
  busy,
  burnSubtitles,
  subtitlesAvailable,
  onToggleSubtitles,
  onPreview,
  onRender,
  onRetry,
  onDownload,
}: ClipRenderControlsProps) {
  const state = getClipRenderState(clip, render);

  return (
    <div
      aria-label={`9:16 reel for ${clip.title}`}
      className="mt-3 border-t border-[#eef2f0] pt-3"
      role="group"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">9:16 reel</span>
        <span
          className={`px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${badgeClass(state)}`}
          role="status"
        >
          {describeState(state)}
        </span>
      </div>
      {state.kind === 'failed' && state.message ? (
        <p className="mt-2 text-xs text-[#8f2f1f]">{state.message}</p>
      ) : null}
      <label className="mt-2 flex items-center gap-2 text-xs">
        <input
          checked={burnSubtitles}
          className="h-4 w-4 accent-[#0f766e]"
          disabled={!subtitlesAvailable}
          onChange={(event) => onToggleSubtitles(event.target.checked)}
          type="checkbox"
        />
        Burn in subtitles
      </label>
      {!subtitlesAvailable ? (
        <p className="mt-1 text-xs text-[#5f6e69]">
          Transcribe the video to burn in subtitles.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className={buttonClass}
          disabled={busy}
          onClick={onPreview}
          type="button"
        >
          Preview 9:16
        </button>
        {state.kind === 'idle' ? (
          <button
            className={buttonClass}
            disabled={busy}
            onClick={onRender}
            type="button"
          >
            {busy ? 'Starting render' : 'Render 9:16'}
          </button>
        ) : null}
        {state.kind === 'active' ? (
          <button className={buttonClass} disabled type="button">
            Rendering
          </button>
        ) : null}
        {state.kind === 'ready' ? (
          <button
            className={buttonClass}
            disabled={busy}
            onClick={onDownload}
            type="button"
          >
            Download 9:16
          </button>
        ) : null}
        {state.kind === 'failed' ? (
          <button
            className={buttonClass}
            disabled={busy}
            onClick={() => onRetry(state.renderId)}
            type="button"
          >
            {busy ? 'Retrying' : 'Retry render'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface BulkRenderControlsProps {
  summary: RenderSummary;
  busy: boolean;
  burnSubtitles: boolean;
  hasClipOverrides: boolean;
  hasEditedClips?: boolean;
  subtitlesAvailable: boolean;
  onToggleSubtitles: (enabled: boolean) => void;
  onRenderAll: () => void;
}

export function BulkRenderControls({
  summary,
  busy,
  burnSubtitles,
  hasClipOverrides,
  hasEditedClips = false,
  subtitlesAvailable,
  onToggleSubtitles,
  onRenderAll,
}: BulkRenderControlsProps) {
  if (summary.total === 0) return null;

  const nothingToRender = summary.pending + summary.failed === 0;
  const details = [
    `${summary.ready} of ${summary.total} ready`,
    summary.active > 0 ? `${summary.active} rendering` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="mt-3 border border-[#d8e1dc] bg-white p-3">
      <button
        className="h-9 w-full bg-[#0f766e] px-3 text-sm font-semibold text-white hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
        disabled={busy || nothingToRender}
        onClick={onRenderAll}
        type="button"
      >
        {busy ? 'Starting renders' : 'Render all clips (9:16)'}
      </button>
      <label className="mt-2 flex items-center gap-2 text-xs">
        <input
          checked={burnSubtitles}
          className="h-4 w-4 accent-[#0f766e]"
          disabled={!subtitlesAvailable}
          onChange={(event) => onToggleSubtitles(event.target.checked)}
          type="checkbox"
        />
        Burn in subtitles for all clips
      </label>
      {hasClipOverrides ? (
        <p className="mt-1 text-xs text-[#5f6e69]">
          Some clips use their own subtitle setting.
        </p>
      ) : null}
      {hasEditedClips ? (
        <p className="mt-1 text-xs text-[#5f6e69]">
          Some clips use edited subtitle text.
        </p>
      ) : null}
      <p className="mt-2 text-xs text-[#5f6e69]">{details.join(' · ')}</p>
    </div>
  );
}
