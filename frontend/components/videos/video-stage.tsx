'use client';

import type { SubtitleStyle } from '@/lib/api';
import {
  getPreviewPositionStyle,
  getPreviewTextStyle,
} from '@/lib/subtitle-style';
import { formatClock } from '@/lib/trimmer';
import { useRef, useState, type RefObject } from 'react';

export type StageFrame = 'landscape' | 'vertical';

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

export type GuidePlatform = 'tiktok' | 'instagram' | 'facebook';

interface GuideSpec {
  label: string;
  /** Number of UI buttons in the right-hand rail. */
  rail: number;
  /** Tailwind position of the right-hand rail. */
  railPos: string;
  /** Where the caption / username zone starts, from the top. */
  zoneTop: string;
}

const GUIDES: Record<GuidePlatform, GuideSpec> = {
  tiktok: { label: 'TikTok', rail: 4, railPos: 'top-1/3', zoneTop: '68%' },
  instagram: {
    label: 'Instagram',
    rail: 4,
    railPos: 'bottom-[18%]',
    zoneTop: '72%',
  },
  facebook: {
    label: 'Facebook',
    rail: 3,
    railPos: 'bottom-[20%]',
    zoneTop: '70%',
  },
};

const GUIDE_ORDER: GuidePlatform[] = ['tiktok', 'instagram', 'facebook'];

function PlatformIcon({ platform }: { platform: GuidePlatform }) {
  const common = {
    'aria-hidden': true,
    height: 16,
    width: 16,
    viewBox: '0 0 24 24',
  } as const;
  if (platform === 'tiktok') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M16.6 2h-3.2v13.1a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .8.1V9a6.1 6.1 0 1 0 5.3 6V8.6a7.4 7.4 0 0 0 4.3 1.4V6.8a4.3 4.3 0 0 1-4.3-4.8z" />
      </svg>
    );
  }
  if (platform === 'instagram') {
    return (
      <svg
        {...common}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <rect height="18" rx="5" width="18" x="3" y="3" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" fill="currentColor" r="0.8" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="currentColor">
      <path d="M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-.9.3-1.6 1.6-1.6H17V4a20 20 0 0 0-2.5-.1c-2.5 0-4.2 1.5-4.2 4.3v2.3H7.5v3.3h2.8V22z" />
    </svg>
  );
}

function CaptionIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      <rect height="14" rx="3" width="20" x="2" y="5" />
      <path d="M7 10.5h3M7 14h6M14 10.5h3" />
    </svg>
  );
}

interface VideoStageProps {
  playerRef: RefObject<HTMLVideoElement | null>;
  sourceUrl: string | null;
  /** True when the full episode is loaded (not a clip preview). */
  isEpisode: boolean;
  frame: StageFrame;
  onFrameChange: (frame: StageFrame) => void;
  currentTime: number;
  durationSec: number;
  /** Subtitle line at the playhead. Only passed for the full episode. */
  caption: string | null;
  /** Chosen subtitle style; the caption follows it when given. */
  subtitleStyle?: SubtitleStyle | null;
  /** Whether captions are drawn on the stage. Off by default. */
  subtitlesOn?: boolean;
  onSubtitlesToggle?: (() => void) | null;
  subtitlesDisabled?: boolean;
  /** 1-based number of the AI clip under the playhead, 0 when none. */
  liveHook: number;
  onTimeUpdate: (seconds: number) => void;
  onLoadedMetadata: () => void;
  onSeek: (seconds: number) => void;
  onBackToEpisode: () => void;
  /** Label of the clip being previewed, e.g. "Clip 2 of 5 · 00:10 - 00:40". */
  clipLabel?: string | null;
  onPrevClip?: (() => void) | null;
  onNextClip?: (() => void) | null;
  /** True from the click on a clip until the player can show a frame. */
  loading?: boolean;
  /** Called once the player has a frame ready (or failed). */
  onReady?: () => void;
  /**
   * Set when a clip is previewed from the full episode file. The seek bar and
   * clock then show clip time (0 - clip length) instead of episode time.
   */
  windowStart?: number | null;
  windowEnd?: number | null;
}

export function VideoStage({
  playerRef,
  sourceUrl,
  isEpisode,
  frame,
  onFrameChange,
  currentTime,
  durationSec,
  caption,
  subtitleStyle = null,
  subtitlesOn = false,
  onSubtitlesToggle = null,
  subtitlesDisabled = false,
  liveHook,
  onTimeUpdate,
  onLoadedMetadata,
  onSeek,
  onBackToEpisode,
  clipLabel = null,
  onPrevClip = null,
  onNextClip = null,
  loading = false,
  onReady,
  windowStart = null,
  windowEnd = null,
}: VideoStageProps) {
  const box = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [guide, setGuide] = useState<GuidePlatform | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);

  const vertical = frame === 'vertical';
  const windowed = windowStart !== null && windowEnd !== null;
  const base = windowed ? windowStart : 0;
  const duration = windowed
    ? Math.max(windowEnd - windowStart, 0.1)
    : mediaDuration || durationSec;
  const shownTime = windowed
    ? Math.min(Math.max(currentTime - base, 0), duration)
    : currentTime;
  const showSpinner = (loading || buffering) && !failed;

  function seekRelative(seconds: number) {
    onSeek(base + Math.min(Math.max(seconds, 0), duration));
  }

  function markReady() {
    setBuffering(false);
    setFailed(false);
    onReady?.();
  }

  function togglePlay() {
    const element = playerRef.current;
    if (!element) return;
    if (element.paused) {
      // A finished clip preview starts over instead of staying at its end.
      if (windowed && shownTime >= duration - 0.05) seekRelative(0);
      void element.play().catch(() => undefined);
    } else element.pause();
  }

  function cycleSpeed() {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (playerRef.current) playerRef.current.playbackRate = SPEEDS[next];
  }

  return (
    <section
      aria-label="Video stage"
      className="rounded-2xl border border-[#e2eae6] bg-white p-4 shadow-[var(--shadow-surface)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Viewport Stage</h2>
          <p className="text-[11px] text-[#5d6d68]">
            {isEpisode
              ? `Full episode${resolution ? ` · ${resolution} master` : ''}`
              : (clipLabel ?? 'Previewing a clip')}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          <div className="flex rounded-lg bg-[#f6f8f7] p-0.5">
            {(
              [
                ['landscape', '16:9 Full'],
                ['vertical', '9:16 Reel'],
              ] as const
            ).map(([key, label]) => (
              <button
                aria-pressed={frame === key}
                className={`rounded-md px-2 py-1 ${
                  frame === key
                    ? 'bg-white text-[#0f766e] shadow-sm'
                    : 'text-[#5d6d68]'
                }`}
                key={key}
                onClick={() => onFrameChange(key)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {onSubtitlesToggle ? (
            <button
              aria-label="Show subtitles on stage"
              aria-pressed={subtitlesOn}
              className={`flex h-7 w-7 items-center justify-center rounded-lg border disabled:cursor-not-allowed disabled:opacity-40 ${
                subtitlesOn
                  ? 'border-[#0f766e] bg-[#e4f3ef] text-[#0f766e]'
                  : 'border-[#d8e1dc] text-[#5d6d68] hover:border-[#0f766e] hover:text-[#0f766e]'
              }`}
              disabled={subtitlesDisabled}
              onClick={onSubtitlesToggle}
              title={subtitlesOn ? 'Hide subtitles' : 'Show subtitles'}
              type="button"
            >
              <CaptionIcon />
            </button>
          ) : null}
          {vertical ? (
            <div
              aria-label="Platform safe-zone guides"
              className="flex items-center gap-1"
              role="group"
            >
              {GUIDE_ORDER.map((key) => (
                <button
                  aria-label={`${GUIDES[key].label} guides`}
                  aria-pressed={guide === key}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg border ${
                    guide === key
                      ? 'border-[#0f766e] bg-[#e4f3ef] text-[#0f766e]'
                      : 'border-[#d8e1dc] text-[#5d6d68] hover:border-[#0f766e] hover:text-[#0f766e]'
                  }`}
                  key={key}
                  onClick={() =>
                    setGuide((current) => (current === key ? null : key))
                  }
                  title={`${GUIDES[key].label} guides`}
                  type="button"
                >
                  <PlatformIcon platform={key} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div
        className={`relative mt-3 flex items-center justify-center overflow-hidden rounded-xl bg-[#1f2b28] ${
          vertical ? 'h-[30rem]' : 'aspect-video'
        }`}
        ref={box}
      >
        <div
          className={`relative overflow-hidden bg-black ${
            vertical ? 'aspect-[9/16] h-full' : 'h-full w-full'
          }`}
        >
          {sourceUrl ? (
            <video
              className={`h-full w-full ${vertical ? 'object-cover' : 'object-contain'}`}
              muted={muted}
              onCanPlay={markReady}
              onError={() => {
                setBuffering(false);
                setFailed(true);
                onReady?.();
              }}
              onLoadStart={() => {
                setFailed(false);
                setBuffering(true);
              }}
              onLoadedMetadata={(event) => {
                const element = event.currentTarget;
                element.playbackRate = SPEEDS[speedIndex];
                setMediaDuration(
                  Number.isFinite(element.duration) ? element.duration : 0,
                );
                if (isEpisode && element.videoHeight) {
                  setResolution(`${element.videoHeight}p`);
                }
                onLoadedMetadata();
              }}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onPlaying={markReady}
              onSeeked={markReady}
              onSeeking={() => setBuffering(true)}
              onWaiting={() => setBuffering(true)}
              onTimeUpdate={(event) =>
                onTimeUpdate(event.currentTarget.currentTime)
              }
              preload="auto"
              ref={playerRef}
              src={sourceUrl}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center text-sm text-[#dce6e1]">
              Select a clip to preview it.
            </div>
          )}
          {showSpinner ? (
            <div
              aria-live="polite"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/45 text-white"
              role="status"
            >
              <span className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
              <span className="text-xs font-semibold">Loading video...</span>
            </div>
          ) : null}
          {failed ? (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 px-6 text-center text-xs font-semibold text-white"
              role="alert"
            >
              This video could not be loaded. Try another clip or refresh.
            </div>
          ) : null}
          {vertical && guide ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              <span className="absolute left-2 top-2 rounded bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white/80">
                Safe top
              </span>
              <div
                className={`absolute right-2 flex flex-col gap-2 ${GUIDES[guide].railPos}`}
              >
                {Array.from({ length: GUIDES[guide].rail }, (_, index) => (
                  <span
                    className="h-6 w-6 rounded-full border border-white/40 bg-black/25"
                    key={index}
                  />
                ))}
              </div>
              <div
                className="absolute inset-x-3 bottom-3 rounded border border-dashed border-white/30"
                style={{ top: GUIDES[guide].zoneTop }}
              />
            </div>
          ) : null}
          {liveHook ? (
            <span className="absolute right-2 top-2 rounded bg-[#0f766e] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              Live hook #{liveHook}
            </span>
          ) : null}
          {caption && subtitleStyle ? (
            <div
              className="pointer-events-none absolute inset-x-0 flex justify-center px-[6%]"
              style={{
                containerType: 'inline-size',
                ...getPreviewPositionStyle(subtitleStyle.position),
              }}
            >
              <p
                className="px-[3%] py-[1%] text-center leading-snug"
                dir="auto"
                style={getPreviewTextStyle(subtitleStyle)}
              >
                {caption}
              </p>
            </div>
          ) : caption ? (
            <p
              className="absolute inset-x-4 bottom-8 rounded-lg bg-black/60 px-3 py-2 text-center text-base font-bold leading-7 text-white"
              dir="auto"
              style={{ fontFamily: 'var(--font-cairo), sans-serif' }}
            >
              {caption}
            </p>
          ) : null}
        </div>
      </div>

      <input
        aria-label="Seek"
        className="mt-3 w-full accent-[#0f766e]"
        disabled={!sourceUrl || !duration}
        max={duration || 1}
        min={0}
        onChange={(event) => seekRelative(Number(event.target.value))}
        step={0.1}
        type="range"
        value={Math.min(shownTime, duration || 1)}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <button
          aria-label="Back 10 seconds"
          className="h-9 w-9 rounded-full border border-[#d8e1dc]"
          onClick={() => seekRelative(shownTime - 10)}
          type="button"
        >
          ↺
        </button>
        {!isEpisode && (onPrevClip || onNextClip) ? (
          <button
            aria-label="Previous clip"
            className="h-9 w-9 rounded-full border border-[#d8e1dc] disabled:opacity-40"
            disabled={!onPrevClip}
            onClick={() => onPrevClip?.()}
            type="button"
          >
            ⏮
          </button>
        ) : null}
        <button
          aria-label={playing ? 'Pause' : 'Play'}
          className="h-11 w-11 rounded-full bg-[#0f766e] text-white"
          onClick={togglePlay}
          type="button"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          aria-label="Forward 10 seconds"
          className="h-9 w-9 rounded-full border border-[#d8e1dc]"
          onClick={() => seekRelative(shownTime + 10)}
          type="button"
        >
          ↻
        </button>
        {!isEpisode && (onPrevClip || onNextClip) ? (
          <button
            aria-label="Next clip"
            className="h-9 w-9 rounded-full border border-[#d8e1dc] disabled:opacity-40"
            disabled={!onNextClip}
            onClick={() => onNextClip?.()}
            type="button"
          >
            ⏭
          </button>
        ) : null}
        <span className="rounded bg-[#f6f8f7] px-2 py-1 font-mono text-xs">
          {formatClock(shownTime)} / {formatClock(duration)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            aria-label="Playback speed"
            className="rounded bg-[#f6f8f7] px-2 py-1 font-mono text-xs"
            onClick={cycleSpeed}
            type="button"
          >
            {SPEEDS[speedIndex]}x
          </button>
          <button
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="text-base"
            onClick={() => setMuted((value) => !value)}
            type="button"
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            aria-label="Fullscreen"
            className="text-base"
            onClick={() => void box.current?.requestFullscreen?.()}
            type="button"
          >
            ⛶
          </button>
        </span>
      </div>

      {!isEpisode ? (
        <button
          className="mt-2 text-[11px] font-semibold text-[#0f766e] underline"
          onClick={onBackToEpisode}
          type="button"
        >
          Back to full episode
        </button>
      ) : null}
    </section>
  );
}
