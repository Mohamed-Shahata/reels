'use client';

import { useAuth } from '@/components/auth/auth-provider';
import { PageLoading } from '@/components/common/page-loading';
import { AppFooter } from '@/components/layout/app-footer';
import { AppHeader } from '@/components/layout/app-header';
import {
  api,
  getApiErrorMessage,
  type Clip,
  type LibraryVideo,
  type Transcript,
} from '@/lib/api';
import { estimateViralScore } from '@/lib/clip-insights';
import {
  MAX_CLIP_SEC,
  MIN_CLIP_SEC,
  QUICK_TRIMS,
  TITLE_MAX,
  activeSubtitle,
  boundarySentences,
  checkRange,
  estimateFileMb,
  formatClock,
  moveHandle,
  parseClock,
  quickTrimEnd,
  rulerTicks,
  snapToSentences,
} from '@/lib/trimmer';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Frame = 'master' | 'reel';
type Tab = 'all' | 'ai' | 'manual';
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

const card =
  'rounded-2xl border border-[#e2eae6] bg-white p-5 shadow-[var(--shadow-surface)]';

export default function TrimmerPage() {
  const { status } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const stage = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<'start' | 'end' | null>(null);

  const [video, setVideo] = useState<LibraryVideo | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [frame, setFrame] = useState<Frame>('reel');
  const [guides, setGuides] = useState(true);
  const [tab, setTab] = useState<Tab>('all');
  const [zoom, setZoom] = useState(1);
  const [snapping, setSnapping] = useState(true);
  const [range, setRange] = useState({ startSec: 0, endSec: 30 });
  const [startText, setStartText] = useState('00:00');
  const [endText, setEndText] = useState('00:30');
  const [title, setTitle] = useState('');
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [previewEnd, setPreviewEnd] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  useEffect(() => {
    if (status !== 'authenticated' || !params.id) return;
    Promise.all([
      api.getVideos(),
      api.getClips(params.id),
      api.getVideoPlaybackUrl(params.id),
      api.getVideoTranscript(params.id).catch(() => null),
    ])
      .then(([videos, nextClips, playback, nextTranscript]) => {
        const found = videos.find((item) => item.id === params.id) ?? null;
        if (!found) return setError('Video was not found.');
        if (found.status !== 'READY')
          return setError('This video is not ready for clipping yet.');
        setVideo(found);
        setClips(nextClips);
        setTranscript(nextTranscript);
        setSourceUrl(playback.url);
        const first = nextClips.find((clip) => clip.source === 'AI');
        if (first) applyClip(first, false);
      })
      .catch((requestError) =>
        setError(
          getApiErrorMessage(requestError, 'Timeline could not be loaded.'),
        ),
      )
      .finally(() => setLoading(false));
    // applyClip only touches state setters, so it is safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, status]);

  const total = video?.durationSec ?? 0;

  function setRangeAndText(next: { startSec: number; endSec: number }) {
    setRange(next);
    setStartText(formatClock(next.startSec));
    setEndText(formatClock(next.endSec));
  }

  function applyClip(clip: Clip, seek = true) {
    setRangeAndText({ startSec: clip.startSec, endSec: clip.endSec });
    setTitle(clip.title);
    setActiveClipId(clip.id);
    if (seek) seekTo(clip.startSec);
  }

  function seekTo(seconds: number) {
    if (!player.current) return;
    player.current.currentTime = seconds;
    setCurrentTime(seconds);
  }

  function togglePlay() {
    const el = player.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }

  function commitText(field: 'start' | 'end', value: string) {
    if (field === 'start') setStartText(value);
    else setEndText(value);
    const parsed = parseClock(value);
    if (parsed === null) return;
    setRange((current) =>
      field === 'start'
        ? { ...current, startSec: parsed }
        : { ...current, endSec: parsed },
    );
  }

  function applyRange(next: { startSec: number; endSec: number }) {
    setRangeAndText(snapping ? snapToSentences(transcript, next) : next);
  }

  function timeFromPointer(clientX: number): number {
    const box = track.current?.getBoundingClientRect();
    if (!box || !total) return 0;
    const ratio = (clientX - box.left) / box.width;
    return Math.min(total, Math.max(0, ratio * total));
  }

  function onTrackPointerMove(event: React.PointerEvent) {
    if (!dragging.current) return;
    const next = moveHandle(
      dragging.current,
      timeFromPointer(event.clientX),
      range,
      total,
    );
    setRangeAndText({
      startSec: Math.round(next.startSec),
      endSec: Math.round(next.endSec),
    });
  }

  function endDrag() {
    if (!dragging.current) return;
    dragging.current = null;
    applyRange(range);
  }

  function previewSelection() {
    if (!checks.startBeforeEnd) return;
    setPreviewEnd(range.endSec);
    seekTo(range.startSec);
    void player.current?.play().catch(() => undefined);
  }

  async function saveClip(mode: 'create' | 'update') {
    if (!checks.startBeforeEnd || !checks.withinBounds || !title.trim()) {
      setError('Enter a title and a valid start / end range.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        startSec: range.startSec,
        endSec: range.endSec,
      };
      const saved =
        mode === 'update' && activeClipId
          ? await api.updateClip(activeClipId, payload)
          : await api.createClip(params.id, payload);
      setClips((current) =>
        [...current.filter((clip) => clip.id !== saved.id), saved].sort(
          (a, b) => a.startSec - b.startSec,
        ),
      );
      setActiveClipId(saved.id);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Clip could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  const checks = checkRange(
    parseClock(startText),
    parseClock(endText),
    total || Infinity,
  );
  const length = Math.max(0, range.endSec - range.startSec);
  const activeClip = clips.find((clip) => clip.id === activeClipId) ?? null;
  const aiClips = clips.filter((clip) => clip.source === 'AI');
  const manualClips = clips.filter((clip) => clip.source === 'MANUAL');
  const visible =
    tab === 'ai' ? aiClips : tab === 'manual' ? manualClips : clips;
  const liveClip = clips.find(
    (clip) =>
      clip.source === 'AI' &&
      currentTime >= clip.startSec &&
      currentTime < clip.endSec,
  );
  const liveIndex = liveClip ? aiClips.indexOf(liveClip) + 1 : 0;
  const caption = activeSubtitle(transcript, currentTime);
  const { opening, closing } = boundarySentences(transcript, range);
  const pct = (sec: number) => `${(sec / (total || 1)) * 100}%`;

  if (status === 'loading') return <PageLoading label="Loading timeline..." />;
  if (status !== 'authenticated') return null;

  return (
    <div className="min-h-screen bg-[#eef3f0] text-[#172321]">
      <AppHeader />
      <main className="mx-auto max-w-[1300px] px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#5d6d68]">
          <span>
            <Link className="font-medium text-[#0f766e]" href="/">
              Back to Workspace
            </Link>{' '}
            / <span className="text-[#172321]">Video Editor &amp; Trimmer</span>
          </span>
          <Link
            className="rounded-full border border-[#d8e1dc] bg-white px-3 py-1 font-semibold text-[#0f766e]"
            href={`/videos/${params.id}`}
          >
            Open full editor (transcript &amp; export)
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[11px] text-[#5d6d68]">
              <span className="rounded-full bg-[#e4f3ef] px-2 py-0.5 font-semibold uppercase text-[#0f766e]">
                Master audio-visual
              </span>
              {total ? <span>Total run: {formatClock(total)}</span> : null}
              {resolution ? <span>• {resolution} Master</span> : null}
            </p>
            <h1
              className="mt-1 text-2xl font-bold"
              dir="auto"
              style={{ fontFamily: 'var(--font-cairo), sans-serif' }}
            >
              {video?.title ?? 'Video editor'}
            </h1>
          </div>
          <ol className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-semibold">
            {['Transcribe', 'Find Clips', 'Subtitles', 'Export'].map(
              (label, index) => {
                const done = index === 0 ? Boolean(transcript) : false;
                const active = index === 1;
                return (
                  <li className="flex items-center gap-1.5" key={label}>
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                        done || active
                          ? 'bg-[#0f766e] text-white'
                          : 'bg-[#e5ece8] text-[#5d6d68]'
                      }`}
                    >
                      {done ? '✓' : index + 1}
                    </span>
                    <span className={active ? '' : 'text-[#5d6d68]'}>
                      {label}
                    </span>
                  </li>
                );
              },
            )}
          </ol>
        </div>

        {error ? (
          <p
            className="mt-4 rounded-lg border-l-2 border-[#c44932] bg-[#fff2ef] px-3 py-2 text-sm text-[#8f2f1f]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="mt-8 text-sm text-[#5d6d68]">Loading timeline...</p>
        ) : null}

        {video && !loading ? (
          <>
            <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {/* Preview canvas */}
              <section className={card}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">
                      Preview Canvas &amp; Safe Zones
                    </h2>
                    <p className="text-[11px] text-[#5d6d68]">
                      Live synced with playhead:{' '}
                      <span className="font-mono text-[#0f766e]">
                        {formatClock(currentTime)}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-semibold">
                    <div className="flex rounded-lg bg-[#f6f8f7] p-0.5">
                      {(
                        [
                          ['master', '16:9 Master'],
                          ['reel', '9:16 Reel'],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          className={`rounded-md px-2 py-1 ${frame === key ? 'bg-white text-[#0f766e] shadow-sm' : 'text-[#5d6d68]'}`}
                          key={key}
                          onClick={() => setFrame(key)}
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      aria-pressed={guides}
                      className={`rounded-lg border px-2 py-1 ${guides ? 'border-[#0f766e] text-[#0f766e]' : 'border-[#d8e1dc] text-[#5d6d68]'}`}
                      onClick={() => setGuides((v) => !v)}
                      type="button"
                    >
                      TikTok Guides
                    </button>
                  </div>
                </div>

                <div
                  className="relative mt-3 flex h-[26rem] items-center justify-center overflow-hidden rounded-xl bg-[#1f2b28]"
                  ref={stage}
                >
                  <div
                    className={`relative overflow-hidden bg-black ${
                      frame === 'reel'
                        ? 'aspect-[9/16] h-full'
                        : 'aspect-video w-full'
                    }`}
                  >
                    {sourceUrl ? (
                      <video
                        className={`h-full w-full ${frame === 'reel' ? 'object-cover' : 'object-contain'}`}
                        muted={muted}
                        onLoadedMetadata={(event) => {
                          const { videoHeight } = event.currentTarget;
                          if (videoHeight) setResolution(`${videoHeight}p`);
                        }}
                        onPause={() => setPlaying(false)}
                        onPlay={() => setPlaying(true)}
                        onTimeUpdate={(event) => {
                          const t = event.currentTarget.currentTime;
                          setCurrentTime(t);
                          if (previewEnd !== null && t >= previewEnd) {
                            event.currentTarget.pause();
                            setPreviewEnd(null);
                          }
                        }}
                        ref={player}
                        src={sourceUrl}
                      />
                    ) : null}
                    {guides ? (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0"
                      >
                        <span className="absolute left-2 top-2 rounded bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white/80">
                          Safe top
                        </span>
                        <div className="absolute right-2 top-1/3 flex flex-col gap-2">
                          {[0, 1, 2, 3].map((i) => (
                            <span
                              className="h-6 w-6 rounded-full border border-white/40 bg-black/25"
                              key={i}
                            />
                          ))}
                        </div>
                        <div className="absolute inset-x-3 bottom-3 top-[68%] rounded border border-dashed border-white/30" />
                      </div>
                    ) : null}
                    {liveIndex ? (
                      <span className="absolute right-2 top-2 rounded bg-[#0f766e] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                        Live hook #{liveIndex}
                      </span>
                    ) : null}
                    {caption ? (
                      <p
                        className="absolute inset-x-4 bottom-8 rounded-lg bg-black/60 px-3 py-2 text-center text-base font-bold leading-7 text-white"
                        dir="auto"
                        style={{ fontFamily: 'var(--font-cairo), sans-serif' }}
                      >
                        {caption}
                      </p>
                    ) : null}
                    <span className="absolute bottom-2 left-2 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white">
                      {formatClock(currentTime)} / {formatClock(total)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <button
                    aria-label="Back 10 seconds"
                    className="h-9 w-9 rounded-full border border-[#d8e1dc]"
                    onClick={() => seekTo(Math.max(0, currentTime - 10))}
                    type="button"
                  >
                    ↺
                  </button>
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
                    onClick={() => seekTo(Math.min(total, currentTime + 10))}
                    type="button"
                  >
                    ↻
                  </button>
                  <span className="rounded bg-[#f6f8f7] px-2 py-1 font-mono text-xs">
                    {formatClock(currentTime)} / {formatClock(total)}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      className="rounded bg-[#f6f8f7] px-2 py-1 font-mono text-xs"
                      onClick={() => {
                        const next = (speedIndex + 1) % SPEEDS.length;
                        setSpeedIndex(next);
                        if (player.current)
                          player.current.playbackRate = SPEEDS[next];
                      }}
                      type="button"
                    >
                      {SPEEDS[speedIndex]}x
                    </button>
                    <button
                      aria-label={muted ? 'Unmute' : 'Mute'}
                      className="text-base"
                      onClick={() => setMuted((v) => !v)}
                      type="button"
                    >
                      {muted ? '🔇' : '🔊'}
                    </button>
                    <button
                      aria-label="Fullscreen"
                      className="text-base"
                      onClick={() => void stage.current?.requestFullscreen?.()}
                      type="button"
                    >
                      ⛶
                    </button>
                  </span>
                </div>
              </section>

              {/* Clips in episode */}
              <section className={card}>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold">Clips in Episode</h2>
                    <p className="text-[11px] text-[#5d6d68]">
                      {aiClips.length} suggested • {manualClips.length} custom
                      created
                    </p>
                  </div>
                  <span className="rounded-full bg-[#e4f3ef] px-2 py-0.5 text-[11px] font-semibold text-[#0f766e]">
                    {clips.length} Clips
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 rounded-lg bg-[#f6f8f7] p-0.5 text-[11px] font-semibold">
                  {(
                    [
                      ['all', `All (${clips.length})`],
                      ['ai', `AI Hooks (${aiClips.length})`],
                      ['manual', `Manual (${manualClips.length})`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      className={`rounded-md py-1.5 ${tab === key ? 'bg-white text-[#0f766e] shadow-sm' : 'text-[#5d6d68]'}`}
                      key={key}
                      onClick={() => setTab(key)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <ul className="mt-3 max-h-[19rem] space-y-2 overflow-y-auto">
                  {visible.length === 0 ? (
                    <li className="p-4 text-center text-xs text-[#5d6d68]">
                      No clips here yet.
                    </li>
                  ) : null}
                  {visible.map((clip) => {
                    const loaded = clip.id === activeClipId;
                    const ai = clip.source === 'AI';
                    return (
                      <li
                        className={`rounded-xl border p-3 ${loaded ? 'border-[#0f766e] bg-[#e4f3ef]' : 'border-transparent'}`}
                        key={clip.id}
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="flex items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 font-bold ${ai ? 'bg-[#0f766e] text-white' : 'bg-[#e5e7eb] text-[#374151]'}`}
                              title="Estimated from duration, speech density and opening hook"
                            >
                              {ai
                                ? `${estimateViralScore(transcript, clip)}% Hook Score`
                                : 'Manual Cut'}
                            </span>
                            <span className="font-mono text-[#5d6d68]">
                              {formatClock(clip.startSec)} -{' '}
                              {formatClock(clip.endSec)}
                            </span>
                          </span>
                          <span className="rounded bg-[#f0f4f2] px-1.5 py-0.5 font-mono">
                            {formatClock(clip.endSec - clip.startSec)}
                          </span>
                        </div>
                        <p
                          className="mt-1.5 text-right text-base font-bold"
                          dir="auto"
                          style={{
                            fontFamily: 'var(--font-cairo), sans-serif',
                          }}
                        >
                          {clip.title}
                        </p>
                        <div className="mt-1 flex items-center justify-between text-[11px]">
                          <span className="text-[#5d6d68]">
                            {ai ? 'AI suggestion' : 'Custom Trim'}
                          </span>
                          <button
                            className="font-semibold text-[#0f766e]"
                            onClick={() => applyClip(clip)}
                            type="button"
                          >
                            {loaded ? 'Loaded in editor ✓' : 'Load clip'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 rounded-lg bg-[#e4f3ef] px-3 py-2 text-[11px] text-[#0b615b]">
                  Reels between 30s – 60s with high hook scores tend to hold
                  attention best on TikTok and Instagram.
                </p>
              </section>
            </div>

            {/* Timeline */}
            <section className={`${card} mt-4`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold">
                    Episode Timeline ({formatClock(total)})
                  </h2>
                  <p className="text-[11px] text-[#5d6d68]">
                    Interactive master track. Click to scrub playhead or drag
                    bracket handles to trim the segment.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[#5d6d68]">
                  <Legend color="#0f766e" label="AI-suggested clips" />
                  <Legend color="#5d6d68" label="Manual clips" />
                  <Legend color="#b45309" label="Active selection range" />
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl bg-[#eef3f0] p-3">
                <div style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
                  <div className="relative h-5 font-mono text-[10px] text-[#5d6d68]">
                    {rulerTicks(total).map((tick) => (
                      <span
                        className="absolute -translate-x-1/2"
                        key={tick}
                        style={{ left: pct(tick) }}
                      >
                        {formatClock(tick)}
                      </span>
                    ))}
                  </div>
                  <div
                    className="relative h-20 cursor-pointer touch-none select-none rounded-lg bg-[repeating-linear-gradient(90deg,#dce6e1_0,#dce6e1_18px,#e6eeea_18px,#e6eeea_36px)]"
                    onPointerDown={(event) => {
                      if (event.target === event.currentTarget)
                        seekTo(timeFromPointer(event.clientX));
                    }}
                    onPointerMove={onTrackPointerMove}
                    onPointerUp={endDrag}
                    ref={track}
                  >
                    {clips.map((clip, index) => {
                      const ai = clip.source === 'AI';
                      return (
                        <button
                          aria-label={`Load ${clip.title}`}
                          className={`absolute inset-y-4 min-w-[1.5rem] rounded-md text-[10px] font-bold text-white ${ai ? 'bg-[#0f766e]' : 'bg-[#8b9a95]'}`}
                          key={clip.id}
                          onClick={() => applyClip(clip)}
                          style={{
                            left: pct(clip.startSec),
                            width: pct(clip.endSec - clip.startSec),
                          }}
                          type="button"
                        >
                          {ai
                            ? `H${aiClips.indexOf(clip) + 1}`
                            : `M${index + 1}`}
                        </button>
                      );
                    })}
                    <div
                      className="pointer-events-none absolute inset-y-1 rounded-md border-2 border-[#b45309] bg-[#b45309]/15"
                      style={{
                        left: pct(range.startSec),
                        width: pct(range.endSec - range.startSec),
                      }}
                    />
                    {(['start', 'end'] as const).map((handle) => (
                      <button
                        aria-label={`Trim ${handle} handle`}
                        className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-[#b45309]"
                        key={handle}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          dragging.current = handle;
                        }}
                        style={{
                          left: pct(
                            handle === 'start' ? range.startSec : range.endSec,
                          ),
                        }}
                        type="button"
                      />
                    ))}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 w-0.5 bg-[#c44932]"
                      style={{ left: pct(currentTime) }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-[#5d6d68]">
                  Active track:{' '}
                  <b className="text-[#172321]">
                    {activeClip
                      ? `${activeClip.source === 'AI' ? `Hook #${aiClips.indexOf(activeClip) + 1}` : 'Manual'} (${formatClock(range.startSec)} – ${formatClock(range.endSec)})`
                      : `Selection (${formatClock(range.startSec)} – ${formatClock(range.endSec)})`}
                  </b>
                </span>
                <span className="flex items-center gap-4 font-semibold text-[#0f766e]">
                  <button onClick={previewSelection} type="button">
                    ▷ Preview Current Selection
                  </button>
                  <button
                    onClick={() => setZoom((z) => (z >= 4 ? 1 : z * 2))}
                    type="button"
                  >
                    ⌕ Zoom track ({zoom}x)
                  </button>
                </span>
              </div>
            </section>

            <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {/* Create clip */}
              <section className={card}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold">Create clip</h2>
                    <p className="text-sm text-[#5d6d68]">
                      Trim and extract an Arabic 9:16 vertical short or custom
                      highlight segment.
                    </p>
                  </div>
                  <span className="rounded-full bg-[#e4f3ef] px-3 py-1 text-xs font-semibold text-[#0f766e]">
                    Clip length: {formatClock(length)}
                  </span>
                </div>

                <label
                  className="mt-5 block text-sm font-semibold"
                  htmlFor="trim-title"
                >
                  <span className="flex justify-between">
                    Clip title
                    <span className="font-mono text-[11px] font-normal text-[#5d6d68]">
                      {title.length} / {TITLE_MAX}
                    </span>
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-xl border border-[#d8e1dc] bg-[#f6f8f7] px-3 text-right text-base outline-none focus:border-[#0f766e]"
                    dir="auto"
                    id="trim-title"
                    maxLength={TITLE_MAX}
                    onChange={(event) => setTitle(event.target.value)}
                    style={{ fontFamily: 'var(--font-cairo), sans-serif' }}
                    value={title}
                  />
                </label>
                <p className="mt-1 text-[11px] text-[#5d6d68]">
                  This title becomes the video filename and social reel
                  description draft.
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Timecode
                    hint={
                      activeClip?.source === 'AI'
                        ? 'Original hook start point detected by AI'
                        : 'Type mm:ss'
                    }
                    label="Start timecode"
                    onChange={(v) => commitText('start', v)}
                    value={startText}
                  />
                  <Timecode
                    hint={`Auto trimmed to exactly ${formatClock(length)} clip window`}
                    label="End timecode"
                    onChange={(v) => commitText('end', v)}
                    value={endText}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                  <Check
                    ok={checks.startBeforeEnd}
                    label="Start must be before End"
                  />
                  <Check
                    ok={checks.withinBounds}
                    label={`Within bounds (00:00 – ${formatClock(total)})`}
                  />
                  <Check
                    ok={checks.durationOk}
                    label={`Duration: Min ${formatClock(MIN_CLIP_SEC)} / Max ${formatClock(MAX_CLIP_SEC)}`}
                  />
                  <Check
                    ok={checks.sweetSpot}
                    label="Sweet spot: 0:15 – 0:60"
                    soft
                  />
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    className="h-10 rounded-lg border border-[#d8e1dc] px-4 text-sm font-medium hover:border-[#0f766e]"
                    onClick={previewSelection}
                    type="button"
                  >
                    ▷ Preview range
                  </button>
                  <button
                    className="h-10 rounded-lg border border-[#d8e1dc] px-4 text-sm font-medium hover:border-[#0f766e] disabled:opacity-50"
                    disabled={!activeClip}
                    onClick={() => activeClip && applyClip(activeClip, false)}
                    type="button"
                  >
                    ↺ Reset to active{' '}
                    {activeClip?.source === 'AI' ? 'AI hook' : 'clip'}
                  </button>
                  {activeClip ? (
                    <button
                      className="h-10 rounded-lg border border-[#0f766e] px-4 text-sm font-semibold text-[#0f766e] disabled:opacity-50"
                      disabled={saving}
                      onClick={() => void saveClip('update')}
                      type="button"
                    >
                      Update loaded clip
                    </button>
                  ) : null}
                  <button
                    className="ml-auto h-10 rounded-lg bg-[#0f766e] px-6 text-sm font-semibold text-white hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
                    disabled={saving}
                    onClick={() => void saveClip('create')}
                    type="button"
                  >
                    {saving ? 'Saving…' : 'Save clip'}
                  </button>
                </div>
              </section>

              <div className="space-y-4">
                <section className={card}>
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold">Platform Quick Trims</h2>
                    <span className="text-[10px] text-[#5d6d68]">
                      Auto-align
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-[#5d6d68]">
                    Quickly extend or contract from current start point (
                    <span className="font-mono text-[#0f766e]">
                      {formatClock(range.startSec)}
                    </span>
                    ):
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {QUICK_TRIMS.map((trim) => {
                      const on = Math.round(length) === trim.sec;
                      return (
                        <button
                          className={`rounded-xl border px-2 py-2 text-center ${on ? 'border-[#0f766e] bg-[#e4f3ef]' : 'border-[#e2eae6] bg-[#f6f8f7]'}`}
                          key={trim.sec}
                          onClick={() =>
                            applyRange({
                              startSec: range.startSec,
                              endSec: quickTrimEnd(
                                range.startSec,
                                trim.sec,
                                total,
                              ),
                            })
                          }
                          type="button"
                        >
                          <b className="block text-sm">{trim.sec}s</b>
                          <span className="text-[10px] text-[#5d6d68]">
                            {trim.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className={card}>
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold">
                      Arabic Sentence Snapping
                    </h2>
                    <button
                      aria-pressed={snapping}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${snapping ? 'bg-[#e4f3ef] text-[#0f766e]' : 'bg-[#eee] text-[#666]'}`}
                      onClick={() => setSnapping((v) => !v)}
                      type="button"
                    >
                      {snapping ? 'Active' : 'Off'}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-[#5d6d68]">
                    Clip boundaries snap to natural sentence starts and ends in
                    the transcript, so cuts never land mid-word.
                  </p>
                  {transcript ? (
                    <div className="mt-3 space-y-2 text-sm">
                      {[
                        ['Start hook sentence', opening, range.startSec],
                        ['Ending punchline', closing, range.endSec],
                      ].map(([label, seg, time]) => (
                        <div
                          className="rounded-lg bg-[#f6f8f7] p-2"
                          key={String(label)}
                        >
                          <div className="flex justify-between text-[10px] text-[#5d6d68]">
                            <span>{String(label)}</span>
                            <span className="font-mono text-[#0f766e]">
                              {formatClock(Number(time))}
                            </span>
                          </div>
                          <p
                            className="mt-1 line-clamp-2 text-right"
                            dir="auto"
                            style={{
                              fontFamily: 'var(--font-cairo), sans-serif',
                            }}
                          >
                            {(seg as { text: string } | null)?.text ?? '—'}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-[#5d6d68]">
                      Transcribe the video to enable sentence snapping.
                    </p>
                  )}
                </section>

                <section className={card}>
                  <h2 className="text-sm font-bold">
                    Export Pipeline Parameters
                  </h2>
                  <dl className="mt-3 space-y-2 text-xs">
                    {[
                      ['Aspect Ratio', '9:16 Vertical (1080 × 1920)'],
                      [
                        'Arabic Font',
                        'Cairo (subtitle style is set in the full editor)',
                      ],
                      ['Reframe', 'Server-side 9:16 crop on export'],
                      [
                        'Estimated File',
                        `~${estimateFileMb(length)} MB (H.264, estimate)`,
                      ],
                    ].map(([k, v]) => (
                      <div className="flex justify-between gap-3" key={k}>
                        <dt className="text-[#5d6d68]">{k}</dt>
                        <dd className="text-right font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
            </div>
          </>
        ) : null}
      </main>
      <AppFooter />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function Check({
  ok,
  label,
  soft = false,
}: {
  ok: boolean;
  label: string;
  soft?: boolean;
}) {
  const color = ok
    ? 'bg-[#e4f3ef] text-[#0b615b]'
    : soft
      ? 'bg-[#fef3c7] text-[#92400e]'
      : 'bg-[#fff2ef] text-[#8f2f1f]';
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-medium ${color}`}
    >
      {ok ? '✓' : soft ? '!' : '✕'} {label}
    </span>
  );
}

function Timecode({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-xl bg-[#f6f8f7] p-3">
      <div className="flex justify-between text-sm font-semibold">
        {label}
        <span className="font-mono text-[10px] font-normal text-[#5d6d68]">
          mm:ss
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          aria-label={label}
          className="h-10 w-24 rounded-lg border border-[#d8e1dc] bg-white px-3 font-mono text-base outline-none focus:border-[#0f766e]"
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
      </div>
      <p className="mt-2 text-[11px] text-[#5d6d68]">{hint}</p>
    </div>
  );
}
