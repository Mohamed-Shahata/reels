'use client';

import type { Clip, Transcript } from '@/lib/api';
import { estimateViralScore } from '@/lib/clip-insights';
import type { TrimDraft } from '@/lib/use-trim-draft';
import {
  MAX_CLIP_SEC,
  MIN_CLIP_SEC,
  QUICK_TRIMS,
  TITLE_MAX,
  boundarySentences,
  estimateFileMb,
  formatClock,
  moveHandle,
  quickTrimEnd,
  rulerTicks,
} from '@/lib/trimmer';
import { useRef, useState } from 'react';

type ClipTab = 'all' | 'ai' | 'manual';

const card =
  'rounded-2xl border border-[#e2eae6] bg-white p-5 shadow-[var(--shadow-surface)]';

interface TrimPanelProps {
  totalSec: number;
  clips: Clip[];
  transcript: Transcript | null;
  /** Clips whose opening line looks like a hook (amber markers). */
  hookClipIds: string[];
  currentTime: number;
  draft: TrimDraft;
  saving: boolean;
  onSeek: (seconds: number) => void;
  onLoadClip: (clip: Clip) => void;
  onPreviewRange: () => void;
  onSave: (mode: 'create' | 'update') => void;
}

export function TrimPanel({
  totalSec,
  clips,
  transcript,
  hookClipIds,
  currentTime,
  draft,
  saving,
  onSeek,
  onLoadClip,
  onPreviewRange,
  onSave,
}: TrimPanelProps) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<'start' | 'end' | null>(null);
  const [zoom, setZoom] = useState(1);
  const [clipTab, setClipTab] = useState<ClipTab>('all');

  const { range, checks, length } = draft;
  const activeClip = clips.find((clip) => clip.id === draft.activeClipId);
  const aiClips = clips.filter((clip) => clip.source === 'AI');
  const manualClips = clips.filter((clip) => clip.source === 'MANUAL');
  const visible =
    clipTab === 'ai' ? aiClips : clipTab === 'manual' ? manualClips : clips;
  const { opening, closing } = boundarySentences(transcript, range);
  const pct = (sec: number) => `${(sec / (totalSec || 1)) * 100}%`;

  function timeFromPointer(clientX: number): number {
    const bounds = track.current?.getBoundingClientRect();
    if (!bounds || !totalSec) return 0;
    const ratio = (clientX - bounds.left) / bounds.width;
    return Math.min(totalSec, Math.max(0, ratio * totalSec));
  }

  function onTrackPointerMove(event: React.PointerEvent) {
    if (!dragging.current) return;
    const next = moveHandle(
      dragging.current,
      timeFromPointer(event.clientX),
      range,
      totalSec,
    );
    draft.setRangeAndText({
      startSec: Math.round(next.startSec),
      endSec: Math.round(next.endSec),
    });
  }

  function endDrag() {
    if (!dragging.current) return;
    dragging.current = null;
    draft.applyRange(range);
  }

  return (
    <div className="space-y-4">
      <section aria-label="Episode timeline" className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">
              Episode Timeline ({formatClock(totalSec)})
            </h2>
            <p className="text-[11px] text-[#5d6d68]">
              Click to scrub the playhead or drag the bracket handles to trim
              the segment.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#5d6d68]">
            <Legend color="#0f766e" label="AI-suggested clips" />
            <Legend color="#8b9a95" label="Manual clips" />
            <Legend color="#b45309" label="Active selection" />
            <Legend
              color="#f59e0b"
              label={`Detected hooks (${hookClipIds.length})`}
              round
            />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl bg-[#eef3f0] p-3">
          <div style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
            <div className="relative h-5 font-mono text-[10px] text-[#5d6d68]">
              {rulerTicks(totalSec).map((tick) => (
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
                if (event.target === event.currentTarget) {
                  onSeek(timeFromPointer(event.clientX));
                }
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
                    onClick={() => onLoadClip(clip)}
                    style={{
                      left: pct(clip.startSec),
                      width: pct(clip.endSec - clip.startSec),
                    }}
                    type="button"
                  >
                    {ai ? `H${aiClips.indexOf(clip) + 1}` : `M${index + 1}`}
                  </button>
                );
              })}
              {clips
                .filter((clip) => hookClipIds.includes(clip.id))
                .map((clip) => (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0.5 h-2 w-2 -translate-x-1/2 rounded-full bg-[#f59e0b]"
                    key={`hook-${clip.id}`}
                    style={{ left: pct(clip.startSec) }}
                  />
                ))}
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
                    event.currentTarget.setPointerCapture(event.pointerId);
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
            <button onClick={onPreviewRange} type="button">
              ▷ Preview Current Selection
            </button>
            <button
              onClick={() => setZoom((value) => (value >= 4 ? 1 : value * 2))}
              type="button"
            >
              ⌕ Zoom track ({zoom}x)
            </button>
          </span>
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
                {draft.title.length} / {TITLE_MAX}
              </span>
            </span>
            <input
              className="mt-2 h-12 w-full rounded-xl border border-[#d8e1dc] bg-[#f6f8f7] px-3 text-right text-base outline-none focus:border-[#0f766e]"
              dir="auto"
              id="trim-title"
              maxLength={TITLE_MAX}
              onChange={(event) => draft.setTitle(event.target.value)}
              style={{ fontFamily: 'var(--font-cairo), sans-serif' }}
              value={draft.title}
            />
          </label>
          <p className="mt-1 text-[11px] text-[#5d6d68]">
            This title becomes the video filename and social reel description
            draft.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Timecode
              hint={
                activeClip?.source === 'AI'
                  ? 'Original hook start point detected by AI'
                  : 'Type mm:ss'
              }
              label="Start timecode"
              onChange={(value) => draft.commitText('start', value)}
              value={draft.startText}
            />
            <Timecode
              hint={`Auto trimmed to exactly ${formatClock(length)} clip window`}
              label="End timecode"
              onChange={(value) => draft.commitText('end', value)}
              value={draft.endText}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            <Check
              ok={checks.startBeforeEnd}
              label="Start must be before End"
            />
            <Check
              ok={checks.withinBounds}
              label={`Within bounds (00:00 – ${formatClock(totalSec)})`}
            />
            <Check
              ok={checks.durationOk}
              label={`Duration: Min ${formatClock(MIN_CLIP_SEC)} / Max ${formatClock(MAX_CLIP_SEC)}`}
            />
            <Check
              ok={checks.sweetSpot}
              label="Sweet spot: 00:15 – 01:00"
              soft
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              className="h-10 rounded-lg border border-[#d8e1dc] px-4 text-sm font-medium hover:border-[#0f766e]"
              onClick={onPreviewRange}
              type="button"
            >
              ▷ Preview range
            </button>
            <button
              className="h-10 rounded-lg border border-[#d8e1dc] px-4 text-sm font-medium hover:border-[#0f766e] disabled:opacity-50"
              disabled={!activeClip}
              onClick={() => activeClip && onLoadClip(activeClip)}
              type="button"
            >
              ↺ Reset to active{' '}
              {activeClip?.source === 'AI' ? 'AI hook' : 'clip'}
            </button>
            {activeClip ? (
              <button
                className="h-10 rounded-lg border border-[#0f766e] px-4 text-sm font-semibold text-[#0f766e] disabled:opacity-50"
                disabled={saving}
                onClick={() => onSave('update')}
                type="button"
              >
                Update loaded clip
              </button>
            ) : null}
            <button
              className="ml-auto h-10 rounded-lg bg-[#0f766e] px-6 text-sm font-semibold text-white hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
              disabled={saving}
              onClick={() => onSave('create')}
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
              <span className="text-[10px] text-[#5d6d68]">Auto-align</span>
            </div>
            <p className="mt-2 text-xs text-[#5d6d68]">
              Quickly extend or contract from the current start point (
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
                    aria-pressed={on}
                    className={`rounded-xl border px-2 py-2 text-center ${on ? 'border-[#0f766e] bg-[#e4f3ef]' : 'border-[#e2eae6] bg-[#f6f8f7]'}`}
                    key={trim.sec}
                    onClick={() =>
                      draft.applyRange({
                        startSec: range.startSec,
                        endSec: quickTrimEnd(
                          range.startSec,
                          trim.sec,
                          totalSec,
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
              <h2 className="text-sm font-bold">Arabic Sentence Snapping</h2>
              <button
                aria-pressed={draft.snapping}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${draft.snapping ? 'bg-[#e4f3ef] text-[#0f766e]' : 'bg-[#eee] text-[#666]'}`}
                onClick={draft.toggleSnapping}
                type="button"
              >
                {draft.snapping ? 'Active' : 'Off'}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-[#5d6d68]">
              Clip boundaries snap to natural sentence starts and ends in the
              transcript, so cuts never land mid-word.
            </p>
            {transcript ? (
              <div className="mt-3 space-y-2 text-sm">
                {(
                  [
                    ['Start hook sentence', opening, range.startSec],
                    ['Ending punchline', closing, range.endSec],
                  ] as const
                ).map(([label, segment, time]) => (
                  <div className="rounded-lg bg-[#f6f8f7] p-2" key={label}>
                    <div className="flex justify-between text-[10px] text-[#5d6d68]">
                      <span>{label}</span>
                      <span className="font-mono text-[#0f766e]">
                        {formatClock(time)}
                      </span>
                    </div>
                    <p
                      className="mt-1 line-clamp-2 text-right"
                      dir="auto"
                      style={{ fontFamily: 'var(--font-cairo), sans-serif' }}
                    >
                      {segment?.text ?? '—'}
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
            <h2 className="text-sm font-bold">Export Pipeline Parameters</h2>
            <dl className="mt-3 space-y-2 text-xs">
              {[
                ['Aspect Ratio', '9:16 Vertical (1080 × 1920)'],
                [
                  'Arabic Font',
                  'Cairo (subtitle style is set in Clips & Export)',
                ],
                ['Reframe', 'Server-side 9:16 crop on export'],
                [
                  'Estimated File',
                  `~${estimateFileMb(length)} MB (H.264, estimate)`,
                ],
              ].map(([key, value]) => (
                <div className="flex justify-between gap-3" key={key}>
                  <dt className="text-[#5d6d68]">{key}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>

      <section className={card}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">Clips in Episode</h2>
            <p className="text-[11px] text-[#5d6d68]">
              {aiClips.length} suggested • {manualClips.length} custom created ·
              load one to trim it, manage and render them in Clips &amp; Export.
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
              aria-pressed={clipTab === key}
              className={`rounded-md py-1.5 ${clipTab === key ? 'bg-white text-[#0f766e] shadow-sm' : 'text-[#5d6d68]'}`}
              key={key}
              onClick={() => setClipTab(key)}
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
            const loaded = clip.id === draft.activeClipId;
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
                      {formatClock(clip.startSec)} - {formatClock(clip.endSec)}
                    </span>
                  </span>
                  <span className="rounded bg-[#f0f4f2] px-1.5 py-0.5 font-mono">
                    {formatClock(clip.endSec - clip.startSec)}
                  </span>
                </div>
                <p
                  className="mt-1.5 text-right text-base font-bold"
                  dir="auto"
                  style={{ fontFamily: 'var(--font-cairo), sans-serif' }}
                >
                  {clip.title}
                </p>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-[#5d6d68]">
                    {ai ? 'AI suggestion' : 'Custom Trim'}
                  </span>
                  <button
                    className="font-semibold text-[#0f766e]"
                    onClick={() => onLoadClip(clip)}
                    type="button"
                  >
                    {loaded ? 'Loaded in trimmer ✓' : 'Load clip'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 rounded-lg bg-[#e4f3ef] px-3 py-2 text-[11px] text-[#0b615b]">
          Reels between 30s – 60s with high hook scores tend to hold attention
          best on TikTok and Instagram.
        </p>
      </section>
    </div>
  );
}

function Legend({
  color,
  label,
  round = false,
}: {
  color: string;
  label: string;
  round?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <i
        className={`h-2.5 w-2.5 ${round ? 'rounded-full' : 'rounded-sm'}`}
        style={{ background: color }}
      />
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
