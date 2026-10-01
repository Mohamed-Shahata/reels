'use client';

import type { Clip, ClipRender } from '@/lib/api';
import {
  getClipRenderState,
  readyPercent,
  renderReference,
  type ClipRenderState,
  type RenderSummary,
} from '@/lib/clip-render';
import type { ReelAspect } from '@/components/videos/clip-card';
import { useState, type ReactNode } from 'react';

interface ClipRenderControlsProps {
  clip: Clip;
  render: ClipRender | undefined;
  busy: boolean;
  burnSubtitles: boolean;
  subtitlesAvailable: boolean;
  aspect: ReelAspect;
  onAspectChange: (a: ReelAspect) => void;
  onToggleSubtitles: (enabled: boolean) => void;
  onPreview: (aspect: ReelAspect) => void;
  onRender: () => void;
  onRetry: (renderId: string) => void;
  /** Stops the render in progress; it can be resumed afterwards. */
  onStop?: (renderId: string) => void;
  /** Throws away the old subtitled video and renders the subtitles again. */
  onRegenerate?: () => void;
  onDownload: () => void;
  /** Still frame of the clip start; shown until (and instead of) a render. */
  thumbnailUrl?: string | null;
}

const btnCls =
  'h-8 rounded-lg border border-[#d5e2dc] bg-white px-3 text-xs font-semibold text-[#3f4f4a] hover:border-[#0f766e] hover:bg-[#e4f3ef] hover:text-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50';

function describeState(s: ClipRenderState) {
  if (s.kind === 'ready') return 'Ready';
  if (s.kind === 'failed') return 'Failed';
  if (s.kind === 'stopped') return 'Stopped';
  if (s.kind === 'active')
    return s.queued ? 'Queued' : `Rendering ${s.progress}%`;
  return 'Not rendered';
}

function badgeCls(s: ClipRenderState) {
  if (s.kind === 'ready') return 'bg-[#dce6e1] text-[#0b615b]';
  if (s.kind === 'failed') return 'bg-[#fff2ef] text-[#c44932]';
  if (s.kind === 'stopped') return 'bg-[#fff7e0] text-[#8a5a00]';
  if (s.kind === 'active') return 'bg-[#e4f3ef] text-[#0f766e]';
  return 'bg-gray-100 text-gray-600';
}

function RenderIcon() {
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
      <rect height="18" rx="2" ry="2" width="20" x="2" y="3" />
      <line x1="8" x2="8" y1="3" y2="21" />
      <line x1="16" x2="16" y1="3" y2="21" />
      <line x1="2" x2="22" y1="9" y2="9" />
      <line x1="2" x2="22" y1="15" y2="15" />
    </svg>
  );
}

function DownloadIcon() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function RegenerateIcon() {
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
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="12"
      viewBox="0 0 24 24"
      width="12"
    >
      <rect height="16" rx="2" width="16" x="4" y="4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="white"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

/**
 * Returns { thumbnail, controls, header } nodes so ClipCard can
 * position them in the correct layout slots.
 */
export function useClipReelNodes({
  clip,
  render,
  busy,
  burnSubtitles,
  subtitlesAvailable,
  aspect,
  onAspectChange,
  onToggleSubtitles,
  onPreview,
  onRender,
  onRetry,
  onStop,
  onRegenerate,
  onDownload,
  thumbnailUrl = null,
}: ClipRenderControlsProps): {
  thumbnail: ReactNode;
  controls: ReactNode;
  header: ReactNode;
} {
  const state = getClipRenderState(clip, render);
  const isPortrait = aspect === '9:16';

  const aspectSwitch = (
    <div className="flex rounded-md border border-[#d8e1dc] bg-[#f6f8f7] p-0.5 text-[10px] font-semibold">
      {(['9:16', '16:9'] as const).map((a) => (
        <button
          aria-pressed={aspect === a}
          className={`rounded px-1.5 py-0.5 transition-colors ${aspect === a ? 'bg-white text-[#0f766e] shadow-sm' : 'text-[#5d6d68] hover:text-[#0f766e]'}`}
          key={a}
          onClick={() => onAspectChange(a)}
          type="button"
        >
          {a}
        </button>
      ))}
    </div>
  );

  const header = (
    <div
      aria-label={`${aspect} reel for ${clip.title}`}
      className="flex items-center justify-between gap-2"
      role="group"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold">{aspect} reel</span>
        {aspectSwitch}
      </div>
      <span
        className={`px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${badgeCls(state)}`}
        role="status"
      >
        {describeState(state)}
      </span>
    </div>
  );

  const thumbnail = (
    <button
      aria-label={`Preview ${aspect} reel for ${clip.title}`}
      className="group relative flex w-full items-center justify-center overflow-hidden rounded-lg bg-[#1f2b28] transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={busy}
      onClick={() => onPreview(aspect)}
      style={
        isPortrait
          ? { aspectRatio: '9/16', width: '100%' }
          : { aspectRatio: '16/9', width: '100%' }
      }
      type="button"
    >
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className="h-full w-full object-cover"
          decoding="async"
          loading="lazy"
          src={thumbnailUrl}
        />
      ) : render?.status === 'COMPLETED' && render.outputUrl ? (
        <video
          className="h-full w-full object-contain"
          muted
          playsInline
          preload="metadata"
          src={`${render.outputUrl}#t=0.5`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-[10px] font-medium text-[#8ba7a0]">
            {state.kind === 'idle' ? 'Not rendered yet' : describeState(state)}
          </span>
        </div>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0f766e]/90">
          <PlayIcon />
        </span>
      </span>
    </button>
  );

  const controls = (
    <div>
      {/* Header shown inside controls slot when in portrait mode */}
      {header}

      {state.kind === 'active' ? (
        <div className="mt-2">
          <div
            aria-label={`Render progress for ${clip.title}`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={state.queued ? 0 : state.progress}
            className="h-1.5 overflow-hidden rounded-full bg-[#dce6e1]"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-[#0f766e] transition-[width] duration-[2800ms] ease-linear"
              style={{ width: `${state.queued ? 4 : state.progress}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-[#5d6d68]">
            {state.queued ? 'Waiting in queue...' : 'Processing video...'}
          </p>
        </div>
      ) : null}

      {state.kind === 'stopped' ? (
        <p className="mt-2 text-[11px] text-[#8a5a00]">
          Rendering was stopped. Resume it whenever you are ready.
        </p>
      ) : null}

      {state.kind === 'failed' ? (
        <div className="mt-2 rounded-md border border-[#f0c9c0] bg-[#fff2ef] px-2 py-1.5 text-xs text-[#8f2f1f]">
          {state.message ? <p>{state.message}</p> : null}
          <p className="mt-0.5 font-mono text-[10px] text-[#a5533f]">
            Reference ID: {renderReference(state.renderId)}
          </p>
        </div>
      ) : null}

      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs">
        <input
          checked={burnSubtitles}
          className="h-4 w-4 cursor-pointer accent-[#0f766e] disabled:cursor-not-allowed"
          disabled={!subtitlesAvailable}
          onChange={(e) => onToggleSubtitles(e.target.checked)}
          type="checkbox"
        />
        Burn in subtitles
      </label>
      {!subtitlesAvailable && (
        <p className="mt-1 text-xs text-[#5d6d68]">
          Transcribe the video to burn in subtitles.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {state.kind === 'idle' && (
          <button
            className={`${btnCls} flex items-center gap-1.5`}
            disabled={busy}
            onClick={onRender}
            type="button"
          >
            <RenderIcon />
            {busy ? 'Starting render' : `Render ${aspect}`}
          </button>
        )}
        {state.kind === 'active' && (
          <button
            className={`${btnCls} flex items-center gap-1.5`}
            disabled
            type="button"
          >
            <RenderIcon />
            Rendering
          </button>
        )}
        {state.kind === 'active' && onStop && render ? (
          <button
            aria-label={`Stop rendering ${clip.title}`}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[#e3b8ae] bg-white px-3 text-xs font-semibold text-[#c44932] hover:bg-[#fff2ef] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => onStop(render.id)}
            title="Stop this render. You can resume it later."
            type="button"
          >
            <StopIcon />
            {busy ? 'Stopping' : 'Stop'}
          </button>
        ) : null}
        {state.kind === 'stopped' && (
          <button
            className={`${btnCls} flex items-center gap-1.5`}
            disabled={busy}
            onClick={() => onRetry(state.renderId)}
            title="Continue the render that was stopped"
            type="button"
          >
            <RenderIcon />
            {busy ? 'Resuming' : 'Resume'}
          </button>
        )}
        {state.kind === 'ready' && (
          <button
            aria-label={`Download ${aspect}`}
            className={`${btnCls} flex items-center gap-1.5`}
            disabled={busy}
            onClick={onDownload}
            title={`Download ${aspect}`}
            type="button"
          >
            <DownloadIcon />
            {aspect}
          </button>
        )}

        {state.kind === 'failed' && (
          <button
            className={`${btnCls} flex items-center gap-1.5`}
            disabled={busy}
            onClick={() => onRetry(state.renderId)}
            type="button"
          >
            <RenderIcon />
            {busy ? 'Retrying' : 'Retry render'}
          </button>
        )}
        {onRegenerate &&
          burnSubtitles &&
          subtitlesAvailable &&
          state.kind !== 'active' && (
            <button
              className={`${btnCls} flex items-center gap-1.5`}
              disabled={busy}
              onClick={onRegenerate}
              title="Delete the current subtitled video and render the subtitles again"
              type="button"
            >
              <RegenerateIcon />
              {busy ? 'Regenerating' : 'Re-generate subtitle'}
            </button>
          )}
      </div>
    </div>
  );

  return { thumbnail, controls, header };
}

export function ClipRenderControls(
  props: Omit<ClipRenderControlsProps, 'aspect' | 'onAspectChange'> & {
    aspect?: ReelAspect;
    onAspectChange?: (a: ReelAspect) => void;
  },
) {
  const [internalAspect, setInternalAspect] = useState<ReelAspect>('9:16');
  const aspect = props.aspect ?? internalAspect;
  const onAspectChange = props.onAspectChange ?? setInternalAspect;

  const { thumbnail, controls } = useClipReelNodes({
    ...props,
    aspect,
    onAspectChange,
  });

  return (
    <div className="mt-3 border-t border-[#eef2f0] pt-3">
      {thumbnail}
      <div className="mt-2">{controls}</div>
    </div>
  );
}

// ─── kept for BulkRenderControls (unchanged below) ───────────────────────────

interface BulkRenderControlsProps {
  summary: RenderSummary;
  busy: boolean;
  burnSubtitles: boolean;
  hasClipOverrides: boolean;
  hasEditedClips?: boolean;
  subtitlesAvailable: boolean;
  onToggleSubtitles: (enabled: boolean) => void;
  onRenderAll: () => void;
  /** Re-renders the subtitles of every clip from scratch. */
  onRegenerateAll?: () => void;
  /** Stops every render that is waiting or running. */
  onStopAll?: () => void;
  stopping?: boolean;
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
  onRegenerateAll,
  onStopAll,
  stopping = false,
}: BulkRenderControlsProps) {
  if (summary.total === 0) return null;

  const nothingToRender = summary.pending + summary.failed === 0;
  const details = [
    `${summary.ready} of ${summary.total} ready`,
    summary.active > 0 ? `${summary.active} rendering` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null,
    summary.stopped ? `${summary.stopped} stopped` : null,
  ].filter((p): p is string => p !== null);

  return (
    <div className="mt-3 rounded-xl border border-[#d8e1dc] bg-white p-3">
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#0f766e] px-4 text-xs font-semibold text-white shadow-sm hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0] disabled:shadow-none"
        disabled={busy || nothingToRender}
        onClick={onRenderAll}
        type="button"
      >
        <RenderIcon />
        {busy ? 'Starting renders' : 'Render all clips (9:16)'}
      </button>
      {onRegenerateAll && burnSubtitles && subtitlesAvailable && (
        <button
          className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-[#0f766e] bg-white px-4 text-xs font-semibold text-[#0f766e] hover:bg-[#e4f3ef] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={onRegenerateAll}
          type="button"
        >
          <RegenerateIcon />
          Re-generate all subtitles
        </button>
      )}
      {onStopAll && (summary.active > 0 || stopping) && (
        <button
          className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-[#c44932] bg-white px-4 text-xs font-semibold text-[#c44932] hover:bg-[#fff2ef] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={stopping}
          onClick={onStopAll}
          title="Stop every render that is waiting or running"
          type="button"
        >
          <StopIcon />
          {stopping ? 'Stopping' : 'Stop all'}
        </button>
      )}
      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs">
        <input
          checked={burnSubtitles}
          className="h-4 w-4 cursor-pointer accent-[#0f766e] disabled:cursor-not-allowed"
          disabled={!subtitlesAvailable}
          onChange={(e) => onToggleSubtitles(e.target.checked)}
          type="checkbox"
        />
        Burn in subtitles for all clips
      </label>
      {hasClipOverrides && (
        <p className="mt-1 text-xs text-[#5d6d68]">
          Some clips use their own subtitle setting.
        </p>
      )}
      {hasEditedClips && (
        <p className="mt-1 text-xs text-[#5d6d68]">
          Some clips use edited subtitle text.
        </p>
      )}
      <div
        aria-label="Render progress for all clips"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={readyPercent(summary)}
        className="mt-3 flex h-2 overflow-hidden rounded-full bg-[#dce6e1]"
        role="progressbar"
      >
        <div
          className="h-full bg-[#0f766e] transition-all"
          style={{ width: `${(summary.ready / summary.total) * 100}%` }}
        />
        <div
          className="h-full bg-[#7cc4bb] transition-all"
          style={{ width: `${(summary.active / summary.total) * 100}%` }}
        />
        <div
          className="h-full bg-[#c44932] transition-all"
          style={{ width: `${(summary.failed / summary.total) * 100}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#5d6d68]">
        <p>{details.join(' · ')}</p>
        <p className="font-semibold text-[#0f766e]">
          {readyPercent(summary)}% ready for export
        </p>
      </div>
    </div>
  );
}
