'use client';

import type { Clip, ClipRender } from '@/lib/api';
import { formatClipLength } from '@/lib/clip-insights';
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
  'h-8 rounded-lg border border-zinc-800 bg-zinc-800/90 px-3 text-xs font-semibold text-zinc-200 hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 transition-colors';

function describeState(s: ClipRenderState) {
  if (s.kind === 'ready') return 'Ready';
  if (s.kind === 'failed') return 'Failed';
  if (s.kind === 'stopped') return 'Stopped';
  if (s.kind === 'active')
    return s.queued ? 'Queued' : `Rendering ${s.progress}%`;
  return 'Not rendered';
}

function badgeCls(s: ClipRenderState) {
  if (s.kind === 'ready')
    return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
  if (s.kind === 'failed')
    return 'bg-rose-500/15 text-rose-400 border border-rose-500/30';
  if (s.kind === 'stopped')
    return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
  if (s.kind === 'active')
    return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse';
  return 'bg-zinc-800 text-zinc-400 border border-zinc-700/50';
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
      fill="currentColor"
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

export interface ClipThumbnailProps {
  clip: Clip;
  render?: ClipRender;
  aspect: ReelAspect;
  isPortrait: boolean;
  onPreview: (aspect: ReelAspect) => void;
  busy: boolean;
  thumbnailUrl?: string | null;
}

export function ClipThumbnail({
  clip,
  render,
  aspect,
  isPortrait,
  onPreview,
  busy,
  thumbnailUrl = null,
}: ClipThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const state = getClipRenderState(clip, render);

  const resolvedUrl = !imgError ? (clip.thumbnailUrl || thumbnailUrl) : null;

  return (
    <button
      aria-label={`Preview ${aspect} reel for ${clip.title}`}
      className="group relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-zinc-950 border border-zinc-800/80 transition-all duration-200 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={busy}
      onClick={() => onPreview(aspect)}
      style={
        isPortrait
          ? { aspectRatio: '9/16', width: '100%' }
          : { aspectRatio: '16/9', width: '100%' }
      }
      type="button"
    >
      {render?.status === 'COMPLETED' && render.outputUrl ? (
        <video
          className="h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
          src={`${render.outputUrl}#t=0.5`}
        />
      ) : resolvedUrl ? (
        <>
          {!imgLoaded && (
            <div className="absolute inset-0 animate-pulse bg-zinc-800/60" />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className={`h-full w-full object-cover transition-opacity duration-300 ${
              imgLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            decoding="async"
            loading="lazy"
            onError={() => setImgError(true)}
            onLoad={() => setImgLoaded(true)}
            src={resolvedUrl}
          />
        </>
      ) : (
        <div className="relative flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 p-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800/80 border border-zinc-700/50 text-zinc-400 group-hover:text-emerald-400 transition-colors">
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <rect height="18" rx="2" width="20" x="2" y="3" />
              <path d="M7 3v18M17 3v18M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" />
            </svg>
          </div>
          <span className="mt-2 text-[10px] font-semibold text-zinc-300">
            {state.kind === 'idle' ? 'Not rendered yet' : describeState(state)}
          </span>
          <span className="mt-1 font-mono text-[9px] text-zinc-500">
            {formatClipLength(clip.startSec, clip.endSec)}
          </span>
        </div>
      )}

      {/* Modern Frosted Glass Play Overlay */}
      <span className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] opacity-0 transition-all duration-200 group-hover:opacity-100">
        <span className="flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-md bg-black/40 text-emerald-400 ring-1 ring-white/10 shadow-lg shadow-black/50 transition-transform duration-200 group-hover:scale-110">
          <PlayIcon />
        </span>
      </span>

      {/* Duration Pill in Corner */}
      <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 backdrop-blur-md px-1.5 py-0.5 font-mono text-[9px] font-medium text-zinc-300">
        {formatClipLength(clip.startSec, clip.endSec)}
      </span>
    </button>
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
    <div className="flex rounded-md border border-zinc-800 bg-zinc-900/90 p-0.5 text-[10px] font-semibold">
      {(['9:16', '16:9'] as const).map((a) => (
        <button
          aria-pressed={aspect === a}
          className={`rounded px-1.5 py-0.5 transition-colors ${aspect === a ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700/60' : 'text-zinc-400 hover:text-emerald-400'}`}
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
        <span className="text-xs font-semibold text-zinc-200">{aspect} reel</span>
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
    <ClipThumbnail
      aspect={aspect}
      busy={busy}
      clip={clip}
      isPortrait={isPortrait}
      onPreview={onPreview}
      render={render}
      thumbnailUrl={thumbnailUrl}
    />
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
            className="h-1.5 overflow-hidden rounded-full bg-zinc-800"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-[2800ms] ease-linear"
              style={{ width: `${state.queued ? 4 : state.progress}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">
            {state.queued ? 'Waiting in queue...' : 'Processing video...'}
          </p>
        </div>
      ) : null}

      {state.kind === 'stopped' ? (
        <p className="mt-2 text-[11px] text-amber-400">
          Rendering was stopped. Resume it whenever you are ready.
        </p>
      ) : null}

      {state.kind === 'failed' ? (
        <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-300">
          {state.message ? <p>{state.message}</p> : null}
          <p className="mt-0.5 font-mono text-[10px] text-rose-400">
            Reference ID: {renderReference(state.renderId)}
          </p>
        </div>
      ) : null}

      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-zinc-300">
        <input
          checked={burnSubtitles}
          className="h-4 w-4 cursor-pointer accent-emerald-500 disabled:cursor-not-allowed"
          disabled={!subtitlesAvailable}
          onChange={(e) => onToggleSubtitles(e.target.checked)}
          type="checkbox"
        />
        Burn in subtitles
      </label>
      {!subtitlesAvailable && (
        <p className="mt-1 text-xs text-zinc-500">
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
            className="flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
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
    <div className="mt-3 border-t border-zinc-800/80 pt-3">
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
    <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4 shadow-xl backdrop-blur-sm">
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-500 px-4 text-xs font-bold text-zinc-950 shadow-md shadow-emerald-500/20 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none transition-colors"
        disabled={busy || nothingToRender}
        onClick={onRenderAll}
        type="button"
      >
        <RenderIcon />
        {busy ? 'Starting renders' : 'Render all clips (9:16)'}
      </button>
      {onRegenerateAll && burnSubtitles && subtitlesAvailable && (
        <button
          className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-zinc-800 px-4 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
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
          className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-4 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          disabled={stopping}
          onClick={onStopAll}
          title="Stop every render that is waiting or running"
          type="button"
        >
          <StopIcon />
          {stopping ? 'Stopping' : 'Stop all'}
        </button>
      )}
      <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-zinc-300">
        <input
          checked={burnSubtitles}
          className="h-4 w-4 cursor-pointer accent-emerald-500 disabled:cursor-not-allowed"
          disabled={!subtitlesAvailable}
          onChange={(e) => onToggleSubtitles(e.target.checked)}
          type="checkbox"
        />
        Burn in subtitles for all clips
      </label>
      {hasClipOverrides && (
        <p className="mt-1 text-xs text-zinc-400">
          Some clips use their own subtitle setting.
        </p>
      )}
      {hasEditedClips && (
        <p className="mt-1 text-xs text-zinc-400">
          Some clips use edited subtitle text.
        </p>
      )}
      <div
        aria-label="Render progress for all clips"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={readyPercent(summary)}
        className="mt-3 flex h-2 overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
      >
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${(summary.ready / summary.total) * 100}%` }}
        />
        <div
          className="h-full bg-teal-400 transition-all"
          style={{ width: `${(summary.active / summary.total) * 100}%` }}
        />
        <div
          className="h-full bg-rose-500 transition-all"
          style={{ width: `${(summary.failed / summary.total) * 100}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <p>{details.join(' · ')}</p>
        <p className="font-semibold text-emerald-400">
          {readyPercent(summary)}% ready for export
        </p>
      </div>
    </div>
  );
}
