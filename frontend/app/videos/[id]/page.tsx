'use client';

import { useAuth } from '@/components/auth/auth-provider';
import { PageLoading } from '@/components/common/page-loading';
import {
  AlertBanner,
  ConfirmDialog,
  WorkspaceSkeleton,
  useToast,
} from '@/components/feedback';
import { AppFooter } from '@/components/layout/app-footer';
import { AppHeader } from '@/components/layout/app-header';
import { AiClipsDialog } from '@/components/videos/ai-clips-dialog';
import { AiClipsProgress } from '@/components/videos/ai-clips-progress';
import { ClipCard } from '@/components/videos/clip-card';
import {
  BulkRenderControls,
  useClipReelNodes,
} from '@/components/videos/clip-render-controls';
import {
  DownloadDialog,
  type DownloadAspect,
  type DownloadPhase,
} from '@/components/videos/download-dialog';
import { ExportSubtitlesButton } from '@/components/videos/export-subtitles-button';
import { SubtitleStyleDialog } from '@/components/videos/subtitle-style-dialog';
import { SubtitleStylePanel } from '@/components/videos/subtitle-style-panel';
import { SubtitleTextEditor } from '@/components/videos/subtitle-text-editor';
import { TranscriptExport } from '@/components/videos/transcript-export';
import { TrimPanel } from '@/components/videos/trim-panel';
import { VideoStage, type StageFrame } from '@/components/videos/video-stage';
import { clipThumbnailUrl } from '@/lib/clip-thumbnail';
import {
  api,
  getApiErrorMessage,
  type AiClipMode,
  type Clip,
  type SubtitleDisplayMode,
  type ClipRender,
  type LibraryVideo,
  type ProcessingJob,
  type Transcript,
  type Usage,
} from '@/lib/api';
import {
  estimateViralScore,
  filterClips,
  hasHook,
  formatClipLength,
  type ClipFilter,
} from '@/lib/clip-insights';
import {
  hasClipOverrides,
  isBurnInEnabled,
  resolveVariant,
  toRenderOptions,
} from '@/lib/burn-in';
import {
  isRenderActive,
  pickRender,
  sameStyle,
  summarizeRenders,
  type RenderVariant,
} from '@/lib/clip-render';
import type { SubtitleSelection } from '@/lib/subtitle-style';
import { activeShortCaption, activeWordCaption } from '@/lib/short-captions';
import {
  buildZip,
  clipFileName,
  DownloadCancelledError,
  fetchVideoBytes,
  mapPool,
  safeFileName,
  saveBlob,
  sortClipsByTimeline,
  subtitledReadiness,
  uniqueNames,
  waitForSubtitledRenders,
} from '@/lib/clip-download';
import { formatClock } from '@/lib/trimmer';
import { useBurnIn } from '@/lib/use-burn-in';
import { useCueEdits } from '@/lib/use-cue-edits';
import { useSubtitleStyle } from '@/lib/use-subtitle-style';
import { useTrimDraft } from '@/lib/use-trim-draft';
import { useVideoRenders } from '@/lib/use-video-renders';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

type WorkspaceTab = 'clips' | 'trim';

const STYLE_SAMPLE_CAPTION = 'هكذا ستظهر الترجمة على الفيديو';
const STYLE_SAMPLE_WORD = 'هكذا';

const TABS: { key: WorkspaceTab; label: string; hint: string }[] = [
  {
    key: 'clips',
    label: 'Clips & Export',
    hint: 'Find clips, render, export',
  },
  { key: 'trim', label: 'Trim', hint: 'Precise cutting' },
];

const card =
  'rounded-2xl border border-[#e2eae6] bg-white p-5 shadow-[var(--shadow-surface)]';

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3"
      viewBox="0 0 24 24"
      width={size}
    >
      <polyline points="5 12.5 10 17.5 19 7.5" />
    </svg>
  );
}

function TabIcon({ name }: { name: WorkspaceTab }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="18"
    >
      {name === 'clips' ? (
        <>
          <rect height="14" rx="3" width="18" x="3" y="5" />
          <path d="m10.5 9.5 4 2.5-4 2.5z" />
        </>
      ) : (
        <>
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
        </>
      )}
    </svg>
  );
}

/** Thin wrapper that owns the hook call so renderReel stays hook-safe. */
function ClipCardWithReel({
  clip,
  score,
  hook,
  number,
  active,
  selected,
  busy,
  rendersBusy,
  subtitlesAvailable,
  burnIn,
  cueEdits,
  displayMode,
  getRenderForClip,
  episodeUrl,
  onToggleSelect,
  onSeek,
  onTrim,
  onDownload,
  onDelete,
  onRename,
  onPreviewClip,
  onRender,
  onRetry,
  onStop,
  onRegenerate,
  onSubtitleTextChange,
  onDownloadReel,
}: {
  clip: Clip;
  score: number;
  hook: boolean;
  /** 1-based place of the clip in the episode. */
  number: number;
  active: boolean;
  selected: boolean;
  busy: boolean;
  rendersBusy: boolean;
  subtitlesAvailable: boolean;
  burnIn: ReturnType<typeof import('@/lib/use-burn-in').useBurnIn>;
  cueEdits: ReturnType<typeof import('@/lib/use-cue-edits').useCueEdits>;
  displayMode: SubtitleDisplayMode;
  getRenderForClip: (clip: Clip) => ClipRender | undefined;
  /** Episode delivery URL; clip stills are cut from it. */
  episodeUrl: string | null;
  onToggleSelect: () => void;
  onSeek: () => void;
  onTrim: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRename: (title: string) => Promise<boolean>;
  onPreviewClip: (reframe: boolean) => void;
  onRender: () => void;
  onRetry: (renderId: string) => void;
  /** Stops this clip's render in progress; it can be resumed. */
  onStop: (renderId: string) => void;
  /** Deletes this clip's subtitled video and renders the subtitles again. */
  onRegenerate: () => void;
  /** The subtitle text of this clip was edited. */
  onSubtitleTextChange: () => void;
  onDownloadReel: () => void;
}) {
  const [aspect, setAspect] =
    useState<import('@/components/videos/clip-card').ReelAspect>('9:16');
  const showSubtitleEditor =
    subtitlesAvailable && isBurnInEnabled(burnIn.settings, clip.id);

  const nodes = useClipReelNodes({
    aspect,
    onAspectChange: setAspect,
    burnSubtitles:
      subtitlesAvailable && isBurnInEnabled(burnIn.settings, clip.id),
    busy: rendersBusy,
    clip,
    onDownload: onDownloadReel,
    onPreview: (a) => onPreviewClip(a === '9:16'),
    onRender,
    onRetry,
    onStop,
    onRegenerate,
    onToggleSubtitles: (enabled) => burnIn.setForClip(clip.id, enabled),
    render: getRenderForClip(clip),
    subtitlesAvailable,
    thumbnailUrl: clipThumbnailUrl(
      episodeUrl,
      clip.startSec,
      clip.endSec,
      aspect,
    ),
  });

  return (
    <ClipCard
      active={active}
      busy={busy}
      clip={clip}
      hook={hook}
      number={number}
      onDelete={onDelete}
      onDownload={onDownload}
      onPreview={() => onPreviewClip(false)}
      onRename={onRename}
      onSeek={onSeek}
      onToggleSelect={onToggleSelect}
      onTrim={onTrim}
      renderReel={() => ({
        thumbnail: nodes.thumbnail,
        controls: (
          <>
            {nodes.controls}
            {subtitlesAvailable ? (
              <ExportSubtitlesButton
                clip={clip}
                displayMode={displayMode}
                edits={cueEdits.editsFor(clip)}
              />
            ) : null}
            {showSubtitleEditor ? (
              <SubtitleTextEditor
                clip={clip}
                displayMode={displayMode}
                edits={cueEdits.editsFor(clip)}
                key={`${clip.id}-${clip.startSec}-${clip.endSec}-${displayMode}`}
                onChange={(edits) => {
                  cueEdits.setEdits(clip, edits);
                  onSubtitleTextChange();
                }}
              />
            ) : null}
          </>
        ),
      })}
      score={score}
      selected={selected}
    />
  );
}

export default function VideoWorkspacePage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<PageLoading label="Loading video workspace..." />}>
      <VideoWorkspace />
    </Suspense>
  );
}

function VideoWorkspace() {
  const { status } = useAuth();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const player = useRef<HTMLVideoElement>(null);
  // A seek requested while the player is (re)loading a source; applied on
  // loadedmetadata so switching from a clip preview back to the episode works.
  const pendingSeek = useRef<{ sec: number; play: boolean } | null>(null);
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<WorkspaceTab>(
    requestedTab === 'trim' ? requestedTab : 'clips',
  );
  const [video, setVideo] = useState<LibraryVideo | null>(null);
  const [rawClips, setClips] = useState<Clip[]>([]);
  // Always in episode order, so clip #1 is the intro, #2 the next, and so on.
  const clips = useMemo(() => sortClipsByTimeline(rawClips), [rawClips]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [previewEndSec, setPreviewEndSec] = useState<number | null>(null);
  // A clip previewed straight from the episode file (no per-clip encode).
  const [previewOnMaster, setPreviewOnMaster] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [confirmStyleChange, setConfirmStyleChange] = useState(false);
  /** Style in effect when the dialog opened, to tell whether it changed. */
  const [selectionAtOpen, setSelectionAtOpen] =
    useState<SubtitleSelection | null>(null);
  const [frame, setFrame] = useState<StageFrame>('landscape');
  // Captions on the stage are opt-in.
  const [stageSubtitles, setStageSubtitles] = useState(false);
  const [savingTrim, setSavingTrim] = useState(false);
  const [creatingAiClips, setCreatingAiClips] = useState(false);
  const [clipActionId, setClipActionId] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  // Download dialog: which clips, which version, and how far along it is.
  const [downloadIds, setDownloadIds] = useState<string[] | null>(null);
  const [downloadAspect, setDownloadAspect] = useState<DownloadAspect>('9:16');
  const [downloadSubtitles, setDownloadSubtitles] = useState(true);
  const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>('confirm');
  const [downloadProgress, setDownloadProgress] = useState<{
    label: string;
    done: number;
    total: number;
  } | null>(null);
  const [downloadSkipped, setDownloadSkipped] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadCancelled = useRef(false);
  const [clipFilter, setClipFilter] = useState<ClipFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiMode, setAiMode] = useState<AiClipMode>('FULL');
  const [clipToDelete, setClipToDelete] = useState<Clip | null>(null);
  const duration = video?.durationSec ?? 0;
  const draft = useTrimDraft(transcript, duration);
  const loadDraftClip = draft.loadClip;
  const renders = useVideoRenders(
    params.id,
    status === 'authenticated' && video !== null,
    setError,
  );
  const cueEdits = useCueEdits();
  const clearCueEdits = cueEdits.clear;
  const subtitleStyle = useSubtitleStyle(
    status === 'authenticated' && video !== null,
  );

  // Cue edits are numbered per cue, and word-by-word has different cues than
  // phrases, so switching the layout starts the edits over.
  const displayModeNow = subtitleStyle.selection?.style.displayMode;
  const previousDisplayMode = useRef(displayModeNow);
  useEffect(() => {
    if (
      displayModeNow !== undefined &&
      previousDisplayMode.current !== undefined &&
      previousDisplayMode.current !== displayModeNow
    ) {
      clearCueEdits();
    }
    previousDisplayMode.current = displayModeNow;
  }, [displayModeNow, clearCueEdits]);
  const burnIn = useBurnIn();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  useEffect(() => {
    if (status !== 'authenticated' || !params.id) return;

    Promise.all([
      api.getVideos(),
      api.getClips(params.id),
      api.getVideoPlaybackUrl(params.id),
      api.getVideoProcessingJobs(params.id),
      api.getVideoTranscript(params.id).catch(() => null),
      api.getUsage().catch(() => null),
    ])
      .then(
        ([
          videos,
          nextClips,
          playback,
          nextJobs,
          nextTranscript,
          nextUsage,
        ]) => {
          const nextVideo =
            videos.find((item) => item.id === params.id) ?? null;
          if (!nextVideo) {
            setError('Video was not found.');
            return;
          }
          if (nextVideo.status !== 'READY') {
            setError('This video is not ready for clipping yet.');
            return;
          }
          setVideo(nextVideo);
          setClips(nextClips);
          setJobs(nextJobs);
          setTranscript(nextTranscript);
          setUsage(nextUsage);
          setSourceUrl(playback.url);
          setOriginalUrl(playback.url);
          // Give the Trim tab something to work on straight away.
          const firstAiClip = nextClips.find((clip) => clip.source === 'AI');
          if (firstAiClip) loadDraftClip(firstAiClip);
        },
      )
      .catch((requestError) => {
        setError(
          getApiErrorMessage(
            requestError,
            'Video workspace could not be loaded.',
          ),
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [params.id, status, loadDraftClip]);

  useEffect(() => {
    if (status !== 'authenticated' || !params.id) return;

    const activeJob = jobs.find(
      (j) =>
        j.type === 'TRANSCRIPTION' &&
        (j.status === 'PENDING' || j.status === 'RUNNING'),
    );
    if (!activeJob) return;

    const interval = setInterval(() => {
      api
        .getVideoProcessingJobs(params.id)
        .then((updatedJobs) => {
          setJobs(updatedJobs);
          const wasActive = updatedJobs.some(
            (j) =>
              j.type === 'TRANSCRIPTION' &&
              (j.status === 'PENDING' || j.status === 'RUNNING'),
          );
          if (!wasActive) {
            // Processing just completed, fetch transcript
            api
              .getVideoTranscript(params.id)
              .then(setTranscript)
              .catch(() => {});
          }
        })
        .catch(() => {});
    }, 3000);

    return () => clearInterval(interval);
  }, [jobs, params.id, status]);

  function variantForClip(clip: Clip): RenderVariant {
    return resolveVariant(
      subtitlesAvailable && isBurnInEnabled(burnIn.settings, clip.id),
      subtitleStyle.selection?.style ?? null,
      cueEdits.editsFor(clip),
    );
  }

  function getRenderForClip(clip: Clip): ClipRender | undefined {
    return pickRender(renders.rendersByClipId[clip.id], variantForClip(clip));
  }

  function getReadySubtitledRender(clip: Clip): ClipRender | null {
    const render = getRenderForClip(clip);
    return render?.subtitles &&
      render.status === 'COMPLETED' &&
      render.outputUrl &&
      render.startSec === clip.startSec &&
      render.endSec === clip.endSec
      ? render
      : null;
  }

  function startRender(clip: Clip) {
    void renders.renderClip(
      clip.id,
      toRenderOptions(variantForClip(clip), subtitleStyle.selection),
    );
  }

  /** Throws away the old subtitled video of one clip and renders it again. */
  function startRegenerate(clip: Clip) {
    void renders.regenerateClip(
      clip.id,
      toRenderOptions(variantForClip(clip), subtitleStyle.selection),
    );
  }

  function startRegenerateAll() {
    const targets = clips.filter(
      (clip) => subtitlesAvailable && isBurnInEnabled(burnIn.settings, clip.id),
    );
    if (targets.length === 0) return;
    renders.discardSubtitled();
    void renders.renderEach(
      targets.map((clip) => ({
        clipId: clip.id,
        options: {
          ...toRenderOptions(variantForClip(clip), subtitleStyle.selection),
          regenerate: true,
        },
      })),
    );
  }

  /** Renders the selected clips, all with or all without burned-in subtitles. */
  function renderSelected(withSubtitles: boolean) {
    const requests = clips
      .filter((clip) => selectedClipIds.includes(clip.id))
      .map((clip) => {
        const variant = resolveVariant(
          withSubtitles && subtitlesAvailable,
          subtitleStyle.selection?.style ?? null,
          cueEdits.editsFor(clip),
        );
        return { clip, variant };
      })
      .filter(({ clip, variant }) => {
        const existing = pickRender(renders.rendersByClipId[clip.id], variant);
        return !(
          existing &&
          ((existing.status === 'COMPLETED' && existing.outputUrl) ||
            isRenderActive(existing))
        );
      });

    for (const { clip } of requests) {
      burnIn.setForClip(clip.id, withSubtitles && subtitlesAvailable);
    }
    if (requests.length === 0) {
      toast.show({
        title: 'Nothing to render',
        description: 'The selected clips already have this version.',
      });
      return;
    }
    void renders.renderEach(
      requests.map(({ clip, variant }) => ({
        clipId: clip.id,
        options: toRenderOptions(variant, subtitleStyle.selection),
      })),
    );
  }

  function startRenderAll() {
    if (!hasClipOverrides(burnIn.settings) && !hasEditedSubtitles) {
      void renders.renderAll(
        toRenderOptions(
          resolveVariant(
            subtitlesAvailable && burnIn.settings.enabled,
            subtitleStyle.selection?.style ?? null,
          ),
          subtitleStyle.selection,
        ),
      );
      return;
    }

    void renders.renderEach(
      clips.map((clip) => ({
        clipId: clip.id,
        options: toRenderOptions(variantForClip(clip), subtitleStyle.selection),
      })),
    );
  }

  async function previewClip(clip: Clip, reframe = false, skipRender = false) {
    setError(null);
    // Show the loader right away; the source swap and the first frame follow.
    setPreviewLoading(true);
    setPreviewClipId(clip.id);
    setFrame(reframe ? 'vertical' : 'landscape');
    setPreviewEndSec(null);
    try {
      // While the style editor is open the live preview is the only subtitle,
      // so a reel that already has old subtitles burned in must not be used.
      const renderedUrl =
        reframe && !skipRender && !styleOpen
          ? (getReadySubtitledRender(clip)?.outputUrl ?? null)
          : null;

      if (renderedUrl) {
        // A finished reel is already a small, cached file.
        pendingSeek.current = null;
        setPreviewOnMaster(false);
        if (sourceUrl === renderedUrl) {
          seekTo(0, true);
          setPreviewLoading(false);
        } else {
          setSourceUrl(renderedUrl);
          setCurrentTime(0);
        }
        return;
      }

      if (originalUrl) {
        // Play the clip range of the episode file: it is already uploaded and
        // seekable, so nothing has to be encoded before the first frame.
        setPreviewOnMaster(true);
        if (sourceUrl === originalUrl) {
          seekTo(clip.startSec, true);
          if (player.current && player.current.readyState >= 1) {
            setPreviewLoading(false);
          }
        } else {
          pendingSeek.current = { sec: clip.startSec, play: true };
          setSourceUrl(originalUrl);
          setCurrentTime(clip.startSec);
        }
        return;
      }

      const url = (await api.getClipPlaybackUrl(clip.id, { reframe })).url;
      pendingSeek.current = null;
      setPreviewOnMaster(false);
      setSourceUrl(url);
      setCurrentTime(0);
    } catch (requestError) {
      setPreviewLoading(false);
      setError(
        getApiErrorMessage(requestError, 'Clip preview could not be loaded.'),
      );
    }
  }

  /** Seeks the player that is currently loaded (episode or clip preview). */
  function seekTo(seconds: number, play = false) {
    setCurrentTime(seconds);
    const element = player.current;
    if (!element || element.readyState < 1) {
      pendingSeek.current = { sec: seconds, play };
      return;
    }
    element.currentTime = seconds;
    if (play) void element.play().catch(() => undefined);
  }

  /** Seeks in the full episode, switching back to it from a clip preview. */
  function seekEpisode(seconds: number, play = false) {
    setPreviewOnMaster(false);
    if (originalUrl && sourceUrl !== originalUrl) {
      pendingSeek.current = { sec: seconds, play };
      setSourceUrl(originalUrl);
      setPreviewClipId(null);
      setPreviewEndSec(null);
      setCurrentTime(seconds);
      return;
    }
    if (previewOnMaster) setPreviewClipId(null);
    seekTo(seconds, play);
  }

  function backToEpisode() {
    if (!originalUrl) return;
    setPreviewClipId(null);
    setFrame('landscape');
    setPreviewEndSec(null);
    setPreviewLoading(false);
    if (sourceUrl === originalUrl) {
      // Already on the episode file: stay where the clip was.
      const resumeAt = previewWindow?.start ?? 0;
      setPreviewOnMaster(false);
      seekTo(resumeAt);
      return;
    }
    pendingSeek.current = null;
    setPreviewOnMaster(false);
    setSourceUrl(originalUrl);
    setCurrentTime(0);
  }

  function handleLoadedMetadata() {
    const pending = pendingSeek.current;
    const element = player.current;
    if (!pending || !element) return;
    pendingSeek.current = null;
    element.currentTime = pending.sec;
    if (pending.play) void element.play().catch(() => undefined);
  }

  function handleTimeUpdate(seconds: number) {
    setCurrentTime(seconds);
    if (previewWindow && seconds >= previewWindow.end) {
      player.current?.pause();
      return;
    }
    if (previewEndSec !== null && seconds >= previewEndSec) {
      player.current?.pause();
      setPreviewEndSec(null);
    }
  }

  function openStyleDialog() {
    // Subtitles are burned into the 9:16 reel, so preview them in that frame.
    setFrame('vertical');
    setSelectionAtOpen(subtitleStyle.selection);
    setStyleOpen(true);
    const current = clips.find((clip) => clip.id === previewClipId);
    if (current && !previewOnMaster) void previewClip(current, true, true);
  }

  /**
   * Reels already rendered with subtitles only match the style they were
   * rendered with, so changing it means re-rendering them. Warn before that
   * happens; the first time (nothing rendered yet) there is nothing to lose.
   */
  function styleChangedSinceOpen(): boolean {
    const before = selectionAtOpen?.style;
    const now = subtitleStyle.selection?.style;
    return Boolean(before && now && !sameStyle(before, now));
  }

  function undoStyleChanges() {
    if (selectionAtOpen) {
      subtitleStyle.restore(selectionAtOpen);
    }
  }

  function requestCloseStyleDialog() {
    // Escape also reaches this dialog while the confirmation is on top.
    if (confirmStyleChange) return;
    const changed = styleChangedSinceOpen();
    const hasSubtitledReels = Object.values(renders.rendersByClipId)
      .flat()
      .some((render) => render.subtitles && render.status !== 'FAILED');
    if (changed && hasSubtitledReels) {
      setConfirmStyleChange(true);
      return;
    }
    // Videos burned with the old style are removed so new ones can be made.
    if (changed) renders.discardSubtitled();
    setStyleOpen(false);
  }

  function selectTab(next: WorkspaceTab) {
    setStyleOpen(false);
    setTab(next);
    window.history.replaceState(
      null,
      '',
      next === 'clips' ? window.location.pathname : `?tab=${next}`,
    );
    // The trimmer works on episode time, so leave any clip preview.
    if (next === 'trim' && !isEpisode) seekEpisode(draft.range.startSec);
  }

  function onTabKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : TABS.length - 1;
    const next = TABS[(index + step) % TABS.length];
    selectTab(next.key);
    document.getElementById(`workspace-tab-${next.key}`)?.focus();
  }

  function openInTrim(clip: Clip) {
    draft.loadClip(clip);
    selectTab('trim');
    seekEpisode(clip.startSec);
  }

  function previewRange() {
    if (!draft.checks.startBeforeEnd) {
      setError('Enter a valid start and end time before previewing the range.');
      return;
    }
    setError(null);
    setPreviewEndSec(draft.range.endSec);
    seekEpisode(draft.range.startSec, true);
  }

  async function saveTrim(mode: 'create' | 'update') {
    if (
      !draft.checks.startBeforeEnd ||
      !draft.checks.withinBounds ||
      !draft.title.trim()
    ) {
      setError('Enter a title and a valid start / end range.');
      return;
    }
    setSavingTrim(true);
    setError(null);
    try {
      const payload = {
        title: draft.title.trim(),
        startSec: draft.range.startSec,
        endSec: draft.range.endSec,
      };
      const saved =
        mode === 'update' && draft.activeClipId
          ? await api.updateClip(draft.activeClipId, payload)
          : await api.createClip(params.id, payload);
      setClips((current) =>
        [...current.filter((clip) => clip.id !== saved.id), saved].sort(
          (a, b) => a.startSec - b.startSec,
        ),
      );
      draft.setActiveClipId(saved.id);
      toast.show({ title: 'Clip saved', description: saved.title });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Clip could not be saved.'));
    } finally {
      setSavingTrim(false);
    }
  }

  async function handleStartTranscription() {
    if (!params.id) return;
    setError(null);
    try {
      await api.startTranscription(params.id);
      const updatedJobs = await api.getVideoProcessingJobs(params.id);
      setJobs(updatedJobs);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          'Could not start transcription. Please try again.',
        ),
      );
    }
  }

  function requestAiClips() {
    setAiDialogOpen(true);
  }

  async function createAiClips() {
    if (!params.id) return;
    const existingAiClips = clips.filter((clip) => clip.source === 'AI').length;
    // Close the popup right away so the page stays usable; the progress bar
    // below the header shows how far the run is.
    setAiDialogOpen(false);
    setCreatingAiClips(true);
    setError(null);
    try {
      const created = await api.createAiClips(params.id, {
        confirmReplace: existingAiClips > 0,
        mode: aiMode,
      });
      setClips((current) =>
        [...current.filter((clip) => clip.source !== 'AI'), ...created].sort(
          (a, b) => a.startSec - b.startSec,
        ),
      );
      toast.show({
        title: 'AI clips ready',
        description:
          aiMode === 'HIGHLIGHTS'
            ? `${created.length} high-reach moments added to your clips.`
            : `${created.length} suggestions added to your clips.`,
      });
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          'AI clip suggestions could not be created.',
        ),
      );
    } finally {
      api
        .getUsage()
        .then(setUsage)
        .catch(() => {});
      setCreatingAiClips(false);
    }
  }

  async function renameClip(clip: Clip, title: string): Promise<boolean> {
    setError(null);
    try {
      const saved = await api.updateClip(clip.id, { title });
      setClips((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      return true;
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Clip could not be renamed.'));
      return false;
    }
  }

  function toggleSelectAll() {
    const visibleIds = visibleClips.map((item) => item.clip.id);
    const allSelected = visibleIds.every((id) => selectedClipIds.includes(id));
    setSelectedClipIds(allSelected ? [] : visibleIds);
  }

  function previewNeighbor(offset: -1 | 1) {
    const target = clips[previewIndex + offset];
    if (target) void previewClip(target, frame === 'vertical');
  }

  async function deleteClip(clip: Clip) {
    setClipToDelete(null);
    setClipActionId(clip.id);
    setError(null);
    try {
      await api.deleteClip(clip.id);
      setClips((current) => current.filter((item) => item.id !== clip.id));
      setSelectedClipIds((current) => current.filter((id) => id !== clip.id));
      if (draft.activeClipId === clip.id) draft.setActiveClipId(null);
      if (previewClipId === clip.id) {
        setPreviewClipId(null);
        setPreviewOnMaster(false);
      }
      toast.show({ title: 'Clip deleted', description: clip.title });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Clip could not be deleted.'));
    } finally {
      setClipActionId(null);
    }
  }

  function toggleClipSelection(clipId: string) {
    setSelectedClipIds((current) =>
      current.includes(clipId)
        ? current.filter((id) => id !== clipId)
        : [...current, clipId],
    );
  }

  async function mergeSelectedClips() {
    if (!params.id || selectedClipIds.length < 2) return;
    const selected = clips.filter((clip) => selectedClipIds.includes(clip.id));
    const title = window.prompt(
      'Title for the merged clip',
      selected[0]?.title,
    );
    if (!title?.trim()) return;

    setClipActionId('merge');
    setError(null);
    try {
      const merged = await api.mergeClips(params.id, {
        clipIds: selectedClipIds,
        title: title.trim(),
      });
      setClips((current) =>
        current
          .filter((clip) => !selectedClipIds.includes(clip.id))
          .concat(merged)
          .sort((a, b) => a.startSec - b.startSec),
      );
      setSelectedClipIds([]);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Clips could not be merged.'));
    } finally {
      setClipActionId(null);
    }
  }

  function fileNameFor(clip: Clip) {
    return clipFileName(
      clip.title,
      clips.findIndex((item) => item.id === clip.id) + 1,
      clips.length,
    );
  }

  function openDownload(ids: string[], aspect: DownloadAspect) {
    downloadCancelled.current = false;
    setDownloadAspect(aspect);
    setDownloadSubtitles(true);
    setDownloadPhase('confirm');
    setDownloadProgress(null);
    setDownloadSkipped(0);
    setDownloadError(null);
    setDownloadIds(ids);
  }

  function closeDownload() {
    setDownloadIds(null);
  }

  function cancelDownload() {
    downloadCancelled.current = true;
  }

  /** Subtitled reel variant for a clip, using the current style and edits. */
  function subtitledVariant(clip: Clip): RenderVariant {
    return resolveVariant(
      true,
      subtitleStyle.selection?.style ?? null,
      cueEdits.editsFor(clip),
    );
  }

  async function runDownload() {
    const chosen = clips.filter((clip) => downloadIds?.includes(clip.id));
    if (chosen.length === 0) return;
    const reel = downloadAspect === '9:16';
    const withSubtitles = downloadSubtitles && reel && subtitlesAvailable;

    downloadCancelled.current = false;
    setDownloadError(null);
    setDownloadSkipped(0);
    setDownloadPhase('working');
    setDownloadProgress({
      label: 'Preparing your download...',
      done: 0,
      total: chosen.length,
    });

    const assertNotCancelled = () => {
      if (downloadCancelled.current) throw new DownloadCancelledError();
    };

    try {
      const sources: { clip: Clip; url: string }[] = [];
      let skipped = 0;

      if (withSubtitles) {
        const states = chosen.map((clip) =>
          subtitledReadiness(
            clip,
            renders.rendersByClipId[clip.id],
            subtitledVariant(clip),
          ),
        );

        // Render whatever has no finished subtitled reel yet.
        for (const [index, clip] of chosen.entries()) {
          if (states[index].kind !== 'needs-render') continue;
          const render = await api.renderClip(
            clip.id,
            toRenderOptions(subtitledVariant(clip), subtitleStyle.selection),
          );
          renders.mergeRenders([render]);
          assertNotCancelled();
        }

        const settled = await waitForSubtitledRenders({
          clips: chosen,
          variantFor: subtitledVariant,
          isCancelled: () => downloadCancelled.current,
          load: async () => {
            const list = await api.getVideoRenders(params.id);
            renders.mergeRenders(list);
            return list;
          },
          onProgress: (done, total) =>
            setDownloadProgress({
              label: `Rendering subtitles ${done} of ${total}`,
              done,
              total,
            }),
        });

        for (const clip of chosen) {
          const render = settled.get(clip.id);
          if (!render) {
            skipped += 1;
            continue;
          }
          const { url } = await api.getRenderDownloadUrl(render.id);
          sources.push({ clip, url });
        }
      } else {
        for (const clip of chosen) {
          const { url } = await api.getClipDownloadUrl(clip.id, {
            reframe: reel,
          });
          sources.push({ clip, url });
        }
      }

      assertNotCancelled();
      if (sources.length === 0) {
        throw new Error('None of the clips could be prepared for download.');
      }

      const names = uniqueNames(sources.map(({ clip }) => fileNameFor(clip)));

      if (chosen.length === 1) {
        setDownloadProgress({
          label: 'Starting download...',
          done: 0,
          total: 1,
        });
        try {
          const bytes = await fetchVideoBytes(sources[0].url);
          saveBlob(
            new Blob([bytes as BlobPart], { type: 'video/mp4' }),
            names[0],
          );
        } catch {
          // The browser could not read the file itself; download it directly.
          window.location.assign(sources[0].url);
        }
      } else {
        let done = 0;
        const total = sources.length;
        const results = await mapPool(sources, 3, async (source, index) => {
          try {
            assertNotCancelled();
            return {
              name: names[index],
              data: await fetchVideoBytes(source.url),
            };
          } catch (requestError) {
            if (requestError instanceof DownloadCancelledError) {
              throw requestError;
            }
            return null;
          } finally {
            done += 1;
            setDownloadProgress({
              label: `Downloading ${done} of ${total}`,
              done,
              total,
            });
          }
        });
        const files = results.filter(
          (file): file is { name: string; data: Uint8Array } => file !== null,
        );
        if (files.length === 0) {
          throw new Error(
            'The clips could not be downloaded. Check your connection and try again.',
          );
        }
        skipped += sources.length - files.length;
        setDownloadProgress({
          label: 'Creating ZIP file...',
          done: total,
          total,
        });
        // Let the loader paint before the zip is built.
        await new Promise((resolve) => setTimeout(resolve, 50));
        saveBlob(
          buildZip(files),
          `${safeFileName(video?.title ?? 'clips', 'clips')} - clips.zip`,
        );
      }

      setDownloadSkipped(skipped);
      setDownloadPhase('success');
    } catch (requestError) {
      if (requestError instanceof DownloadCancelledError) {
        setDownloadIds(null);
        return;
      }
      setDownloadError(
        getApiErrorMessage(
          requestError,
          'The download could not be completed.',
        ),
      );
      setDownloadPhase('error');
    }
  }

  const isEpisode =
    originalUrl !== null && sourceUrl === originalUrl && !previewOnMaster;
  const transcriptionJobs = jobs.filter((job) => job.type === 'TRANSCRIPTION');
  const latestJob = transcriptionJobs[0] ?? null;
  const subtitlesAvailable =
    Boolean(transcript?.segments.length) && subtitleStyle.selection !== null;
  const renderSummary = summarizeRenders(
    clips,
    renders.rendersByClipId,
    variantForClip,
  );
  const hasEditedSubtitles = clips.some(
    (clip) =>
      subtitlesAvailable &&
      isBurnInEnabled(burnIn.settings, clip.id) &&
      cueEdits.editsFor(clip).length > 0,
  );
  const hasAiClips = clips.some((clip) => clip.source === 'AI');
  const previewIndex = previewClipId
    ? clips.findIndex((clip) => clip.id === previewClipId)
    : -1;
  const previewClipItem = previewIndex >= 0 ? clips[previewIndex] : null;
  const previewWindow =
    previewOnMaster && previewClipItem
      ? { start: previewClipItem.startSec, end: previewClipItem.endSec }
      : null;
  const clipLabel = previewClipItem
    ? `Clip ${previewIndex + 1} of ${clips.length} · ${formatClock(previewClipItem.startSec)} - ${formatClock(previewClipItem.endSec)} (${formatClipLength(previewClipItem.startSec, previewClipItem.endSec)})`
    : null;
  const aiRunsExhausted = usage !== null && usage.aiRuns >= usage.aiRunLimit;

  const clipItems = clips.map((clip) => {
    const render = getRenderForClip(clip);
    return {
      clip,
      render,
      score: estimateViralScore(transcript, clip),
      hook: hasHook(transcript, clip),
      ready: render?.status === 'COMPLETED' && Boolean(render.outputUrl),
    };
  });
  const visibleClips = filterClips(clipItems, clipFilter);
  // Numbers follow the episode order, whatever filter is active.
  const clipNumbers = new Map(clips.map((clip, index) => [clip.id, index + 1]));
  const downloadClips = clips.filter((clip) => downloadIds?.includes(clip.id));
  const downloadWithSubtitles =
    downloadSubtitles && downloadAspect === '9:16' && subtitlesAvailable;
  const downloadItems = downloadClips.map((clip) => {
    const readiness = downloadWithSubtitles
      ? subtitledReadiness(
          clip,
          renders.rendersByClipId[clip.id],
          subtitledVariant(clip),
        ).kind
      : 'ready';
    return {
      id: clip.id,
      number: clipNumbers.get(clip.id) ?? 0,
      title: clip.title,
      length: formatClipLength(clip.startSec, clip.endSec),
      note:
        readiness === 'needs-render'
          ? 'Will render'
          : readiness === 'rendering'
            ? 'Rendering'
            : null,
    };
  });
  const downloadRenderCount = downloadItems.filter((item) => item.note).length;
  const downloadFileName =
    downloadClips.length === 1
      ? fileNameFor(downloadClips[0])
      : `${safeFileName(video?.title ?? 'clips', 'clips')} - clips.zip`;
  const transcribed = Boolean(transcript?.segments.length);
  const wordCount = (transcript?.segments ?? []).reduce(
    (sum, segment) => sum + segment.text.trim().split(/\s+/).length,
    0,
  );
  const transcribing = transcriptionJobs.some(
    (job) => job.status === 'PENDING' || job.status === 'RUNNING',
  );
  const anyRendered = clipItems.some((item) => item.ready);
  const currentStep = !transcribed
    ? 1
    : !hasAiClips && clips.length === 0
      ? 2
      : !anyRendered
        ? 3
        : 4;
  const steps = [
    { title: 'Transcribe', sub: 'Step 1' },
    { title: 'Find AI clips', sub: 'Step 2' },
    { title: 'Style subtitles', sub: 'Step 3' },
    { title: 'Render & export', sub: 'Step 4' },
  ];
  const hookClipIds = clipItems
    .filter((item) => item.hook)
    .map((item) => item.clip.id);
  const aiClips = clips.filter((clip) => clip.source === 'AI');
  // Caption and hook badges use episode time, so only show them on the episode.
  const liveClip = isEpisode
    ? aiClips.find(
        (clip) => currentTime >= clip.startSec && currentTime < clip.endSec,
      )
    : undefined;
  const caption =
    isEpisode || previewOnMaster
      ? subtitleStyle.selection?.style.displayMode === 'WORD'
        ? activeWordCaption(transcript, currentTime)
        : activeShortCaption(transcript, currentTime)
      : null;

  if (status === 'loading') {
    return <PageLoading label="Loading video workspace..." />;
  }

  if (status !== 'authenticated') {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#eef3f0] text-[#172321]">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <Link
              className="inline-flex items-center gap-1.5 rounded-full border border-[#d5e2dc] bg-white px-3 py-1.5 font-semibold text-[#0f766e] hover:border-[#0f766e] hover:bg-[#e4f3ef]"
              href="/"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
                viewBox="0 0 24 24"
                width="14"
              >
                <path d="M19 12H5m6-6-6 6 6 6" />
              </svg>
              Back to workspace
            </Link>
            <span className="text-[#5d6d68]">Video editor</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {transcript ? (
              <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-[#5d6d68] ring-1 ring-[#e2eae6]">
                {wordCount.toLocaleString()} words ·{' '}
                {transcript.segments.length} segments
              </span>
            ) : null}
            {duration ? (
              <span className="rounded-full bg-[#e4f3ef] px-3 py-1.5 font-semibold text-[#0f766e]">
                {formatClock(duration)} total duration
              </span>
            ) : null}
          </div>
        </div>
        <h1
          className="mt-4 text-2xl font-extrabold leading-snug tracking-tight sm:text-[2rem]"
          dir="auto"
          style={{ fontFamily: 'var(--font-cairo), sans-serif' }}
        >
          {video?.title ?? 'Video workspace'}
        </h1>

        <ol className="mt-5 grid gap-3 sm:grid-cols-4">
          {steps.map((step, index) => {
            const number = index + 1;
            const done = number < currentStep;
            const active = number === currentStep;
            return (
              <li
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                  active
                    ? 'border-[#0f766e] bg-[#e4f3ef] shadow-[0_0_0_3px_rgba(15,118,110,0.10)]'
                    : done
                      ? 'border-[#cfe6df] bg-white'
                      : 'border-[#e2eae6] bg-white/60'
                }`}
                key={step.title}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    done
                      ? 'bg-[#0f766e] text-white'
                      : active
                        ? 'border-2 border-[#0f766e] bg-white text-[#0f766e]'
                        : 'bg-[#e7eeea] text-[#7b8a85]'
                  }`}
                >
                  {done ? <CheckIcon /> : number}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-[11px] font-semibold ${
                      active ? 'text-[#0f766e]' : 'text-[#7b8a85]'
                    }`}
                  >
                    {active ? 'In progress' : done ? 'Done' : step.sub}
                  </span>
                  <span className="block truncate text-sm font-bold">
                    {step.title}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        {latestJob && latestJob.status !== 'COMPLETED' ? (
          <section
            aria-label="Transcription status"
            className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[#e2eae6] bg-white px-5 py-3 shadow-[var(--shadow-surface)]"
          >
            <span
              className={`inline-flex items-center gap-2 text-sm font-bold ${
                latestJob.status === 'FAILED'
                  ? 'text-[#c44932]'
                  : 'text-[#0f766e]'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full bg-current ${
                  latestJob.status === 'FAILED' ? '' : 'animate-pulse'
                }`}
              />
              {latestJob.status === 'FAILED'
                ? 'Transcription failed'
                : latestJob.status === 'PENDING'
                  ? 'Transcription queued'
                  : `Transcribing audio ${latestJob.progress}%`}
            </span>
            {latestJob.status === 'FAILED' ? (
              <button
                className="h-8 rounded-lg border border-[#0f766e] px-3 text-xs font-bold text-[#0f766e] hover:bg-[#e4f3ef]"
                onClick={() => void handleStartTranscription()}
                type="button"
              >
                Retry
              </button>
            ) : (
              <div
                aria-label="Transcription progress"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={latestJob.progress}
                className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-[#e3ece8]"
                role="progressbar"
              >
                <div
                  className="h-full rounded-full bg-[#0f766e] transition-[width] duration-700 ease-linear"
                  style={{ width: `${latestJob.progress}%` }}
                />
              </div>
            )}
          </section>
        ) : null}

        <AiClipsProgress active={creatingAiClips} mode={aiMode} />

        {error ? (
          <AlertBanner
            className="mt-4"
            onDismiss={() => setError(null)}
            title="Something went wrong"
          >
            {error}
          </AlertBanner>
        ) : null}
        <AiClipsDialog
          busy={creatingAiClips}
          existingAiClips={aiClips.length}
          mode={aiMode}
          onCancel={() => setAiDialogOpen(false)}
          onConfirm={() => void createAiClips()}
          onModeChange={setAiMode}
          open={aiDialogOpen}
        />
        <ConfirmDialog
          confirmLabel="Delete clip"
          onCancel={() => setClipToDelete(null)}
          onConfirm={() => clipToDelete && void deleteClip(clipToDelete)}
          open={clipToDelete !== null}
          subject={clipToDelete?.title}
          title="Delete this clip?"
        >
          The clip and its subtitle edits will be removed. This cannot be
          undone.
        </ConfirmDialog>
        {loading ? <WorkspaceSkeleton /> : null}

        {video && !loading ? (
          <>
            <div
              aria-label="Workspace sections"
              className="mt-5 inline-flex gap-1 rounded-2xl border border-[#e2eae6] bg-white p-1.5 shadow-[var(--shadow-surface)]"
              role="tablist"
            >
              {TABS.map((item, index) => (
                <button
                  aria-controls={`workspace-panel-${item.key}`}
                  aria-selected={tab === item.key}
                  className={`flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-left ${
                    tab === item.key
                      ? 'bg-[#0f766e] text-white shadow-[0_4px_12px_-4px_rgba(15,118,110,0.55)]'
                      : 'text-[#5d6d68] hover:bg-[#f2f6f4]'
                  }`}
                  id={`workspace-tab-${item.key}`}
                  key={item.key}
                  onClick={() => selectTab(item.key)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  role="tab"
                  tabIndex={tab === item.key ? 0 : -1}
                  type="button"
                >
                  <TabIcon name={item.key} />
                  <span>
                    <span className="block text-sm font-bold leading-tight">
                      {item.label}
                    </span>
                    <span
                      className={`block text-[11px] leading-tight ${
                        tab === item.key ? 'text-white/80' : 'text-[#7b8a85]'
                      }`}
                    >
                      {item.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              {/* One player for both tabs so the playhead survives switching. */}
              <div className="lg:sticky lg:top-4">
                <VideoStage
                  caption={
                    (stageSubtitles || styleOpen ? caption : null) ??
                    (styleOpen
                      ? subtitleStyle.selection?.style.displayMode === 'WORD'
                        ? STYLE_SAMPLE_WORD
                        : STYLE_SAMPLE_CAPTION
                      : null)
                  }
                  onSubtitlesToggle={() => setStageSubtitles((on) => !on)}
                  subtitlesDisabled={!transcript?.segments.length}
                  subtitlesOn={stageSubtitles}
                  subtitleStyle={
                    styleOpen || tab === 'clips'
                      ? (subtitleStyle.selection?.style ?? null)
                      : null
                  }
                  currentTime={currentTime}
                  durationSec={duration}
                  frame={frame}
                  isEpisode={isEpisode}
                  loading={previewLoading}
                  onReady={() => setPreviewLoading(false)}
                  windowEnd={previewWindow?.end ?? null}
                  windowStart={previewWindow?.start ?? null}
                  liveHook={liveClip ? aiClips.indexOf(liveClip) + 1 : 0}
                  clipLabel={clipLabel}
                  onBackToEpisode={backToEpisode}
                  onNextClip={
                    previewIndex >= 0 && previewIndex < clips.length - 1
                      ? () => previewNeighbor(1)
                      : null
                  }
                  onPrevClip={
                    previewIndex > 0 ? () => previewNeighbor(-1) : null
                  }
                  onFrameChange={setFrame}
                  onLoadedMetadata={handleLoadedMetadata}
                  onSeek={(seconds) => seekTo(seconds)}
                  onTimeUpdate={handleTimeUpdate}
                  playerRef={player}
                  sourceUrl={sourceUrl}
                />
                {tab === 'clips' ? (
                  <section className={`${card} mt-4`}>
                    <h2 className="text-base font-bold">Hook detection</h2>
                    <p className="mt-1 text-xs text-[#5d6d68]">
                      Clips are scored from their length, speech density and
                      whether the opening line is a question or a hook phrase in
                      Arabic or English. The score is an estimate, not an AI
                      prediction.
                    </p>
                  </section>
                ) : null}
              </div>

              <div>
                <div
                  aria-labelledby="workspace-tab-clips"
                  hidden={tab !== 'clips'}
                  id="workspace-panel-clips"
                  role="tabpanel"
                >
                  <div className="grid items-start gap-4">
                    <TranscriptExport
                      onTranscribe={() => void handleStartTranscription()}
                      transcribing={transcribing}
                      transcript={transcript}
                    />
                    {transcribed ? (
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#e2eae6] bg-white px-4 py-3 text-xs shadow-[var(--shadow-surface)]">
                        <span>
                          Subtitle style
                          {subtitleStyle.selection ? (
                            <>
                              :{' '}
                              <strong>
                                {subtitleStyle.selection.style.fontFamily}{' '}
                                {subtitleStyle.selection.style.fontSizePx}px ·{' '}
                                {subtitleStyle.selection.style.position.toLowerCase()}{' '}
                                ·{' '}
                                {subtitleStyle.selection.style.displayMode ===
                                'WORD'
                                  ? 'word by word'
                                  : 'phrases'}
                              </strong>
                            </>
                          ) : null}
                        </span>
                        <button
                          className="h-8 rounded-lg border border-[#0f766e] px-3 font-semibold text-[#0f766e] hover:bg-[#e4f3ef]"
                          onClick={openStyleDialog}
                          type="button"
                        >
                          Subtitle style
                        </button>
                      </div>
                    ) : null}

                    {/* Clips: manage, render, export */}
                    <aside className={card}>
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-base font-bold">
                          Existing Clips{' '}
                          <span className="ml-1 rounded-full bg-[#e4f3ef] px-2 py-0.5 text-xs font-bold text-[#0f766e]">
                            {clips.length}
                          </span>
                        </h2>
                        <div className="flex items-center gap-2">
                          {selectedClipIds.length >= 2 ? (
                            <button
                              className="h-8 rounded-lg border border-[#0f766e] px-2 text-xs font-semibold text-[#0f766e] disabled:opacity-50"
                              disabled={clipActionId !== null}
                              onClick={() => void mergeSelectedClips()}
                              type="button"
                            >
                              {clipActionId === 'merge'
                                ? 'Merging'
                                : 'Merge selected'}
                            </button>
                          ) : null}
                          {transcript?.segments.length ? (
                            <button
                              className="h-8 rounded-lg bg-[#0f766e] px-3 text-xs font-semibold text-white hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
                              disabled={creatingAiClips || aiRunsExhausted}
                              onClick={requestAiClips}
                              type="button"
                            >
                              {creatingAiClips
                                ? 'Generating…'
                                : hasAiClips
                                  ? 'Re-run AI clips'
                                  : 'Auto-generate'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {usage ? (
                        <p className="mt-1 text-[11px] text-[#5d6d68]">
                          {aiRunsExhausted
                            ? `Monthly AI run limit reached (${usage.aiRuns} of ${usage.aiRunLimit}).`
                            : `AI runs this month: ${usage.aiRuns} of ${usage.aiRunLimit}.`}
                        </p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                        {(
                          [
                            ['all', `All (${clipItems.length})`],
                            [
                              'hooks',
                              `Hooks >90 (${filterClips(clipItems, 'hooks').length})`,
                            ],
                            [
                              'ready',
                              `Ready (${filterClips(clipItems, 'ready').length})`,
                            ],
                            [
                              'draft',
                              `Draft (${filterClips(clipItems, 'draft').length})`,
                            ],
                          ] as const
                        ).map(([key, label]) => (
                          <button
                            className={`rounded-full px-3 py-1.5 ${
                              clipFilter === key
                                ? 'bg-[#0f766e] text-white'
                                : 'bg-[#f2f6f4] text-[#4b5d57] hover:bg-[#e4f3ef] hover:text-[#0f766e]'
                            }`}
                            key={key}
                            onClick={() => setClipFilter(key)}
                            type="button"
                          >
                            {label}
                          </button>
                        ))}
                        {visibleClips.length > 1 ? (
                          <button
                            className="ml-auto rounded-full border border-[#0f766e] px-2.5 py-1 text-[#0f766e]"
                            onClick={toggleSelectAll}
                            type="button"
                          >
                            {visibleClips.every((item) =>
                              selectedClipIds.includes(item.clip.id),
                            )
                              ? 'Clear selection'
                              : 'Select all'}
                          </button>
                        ) : null}
                      </div>

                      {selectedClipIds.length > 0 ? (
                        <div
                          className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#0f766e] bg-[#e4f3ef] px-3 py-2 text-xs"
                          role="group"
                          aria-label="Selected clips"
                        >
                          <strong className="mr-auto text-[#0b615b]">
                            {selectedClipIds.length} selected
                          </strong>
                          <button
                            className="h-8 rounded-lg bg-[#0f766e] px-3 font-semibold text-white hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
                            disabled={
                              renders.renderingAll || !subtitlesAvailable
                            }
                            onClick={() => renderSelected(true)}
                            type="button"
                          >
                            Render with subtitles
                          </button>
                          <button
                            className="h-8 rounded-lg border border-[#0f766e] bg-white px-3 font-semibold text-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={renders.renderingAll}
                            onClick={() => renderSelected(false)}
                            type="button"
                          >
                            Render without subtitles
                          </button>
                          <button
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#0f766e] bg-white px-3 font-semibold text-[#0f766e] hover:bg-[#e4f3ef] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={downloadIds !== null}
                            onClick={() =>
                              openDownload(selectedClipIds, '9:16')
                            }
                            type="button"
                          >
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
                            {selectedClipIds.length > 1
                              ? `Download (${selectedClipIds.length})`
                              : 'Download'}
                          </button>
                        </div>
                      ) : null}

                      <BulkRenderControls
                        burnSubtitles={
                          subtitlesAvailable && burnIn.settings.enabled
                        }
                        busy={renders.renderingAll}
                        hasClipOverrides={hasClipOverrides(burnIn.settings)}
                        hasEditedClips={hasEditedSubtitles}
                        onRegenerateAll={startRegenerateAll}
                        onRenderAll={startRenderAll}
                        onStopAll={() => void renders.stopAll()}
                        onToggleSubtitles={burnIn.setGlobal}
                        stopping={renders.stoppingAll}
                        subtitlesAvailable={subtitlesAvailable}
                        summary={renderSummary}
                      />

                      {visibleClips.length === 0 ? (
                        <p className="mt-4 text-sm text-[#5d6d68]">
                          {clips.length === 0
                            ? transcribed
                              ? 'No clips yet. Auto-generate AI clips, or cut one by hand in the Trim tab.'
                              : 'No clips yet. Transcribe the video first, then generate clips.'
                            : 'No clips match this filter.'}
                        </p>
                      ) : (
                        <ul className="mt-4 max-h-[60rem] space-y-3 overflow-y-auto pr-1">
                          {visibleClips.map(({ clip, score, hook }) => (
                            <ClipCardWithReel
                              active={
                                previewClipId === clip.id ||
                                (isEpisode &&
                                  currentTime >= clip.startSec &&
                                  currentTime < clip.endSec)
                              }
                              burnIn={burnIn}
                              busy={clipActionId === clip.id}
                              clip={clip}
                              cueEdits={cueEdits}
                              displayMode={
                                subtitleStyle.selection?.style.displayMode ??
                                'PHRASE'
                              }
                              episodeUrl={originalUrl}
                              getRenderForClip={getRenderForClip}
                              hook={hook}
                              key={clip.id}
                              number={clipNumbers.get(clip.id) ?? 0}
                              onDelete={() => setClipToDelete(clip)}
                              onDownload={() => openDownload([clip.id], '16:9')}
                              onDownloadReel={() =>
                                openDownload([clip.id], '9:16')
                              }
                              onPreviewClip={(reframe) =>
                                void previewClip(clip, reframe)
                              }
                              onRename={(title) => renameClip(clip, title)}
                              onRender={() => startRender(clip)}
                              onRegenerate={() => startRegenerate(clip)}
                              onRetry={(renderId) =>
                                void renders.retryRender(clip.id, renderId)
                              }
                              onStop={(renderId) =>
                                void renders.stopClip(clip.id, renderId)
                              }
                              onSubtitleTextChange={() =>
                                renders.discardSubtitled(clip.id)
                              }
                              onSeek={() => seekEpisode(clip.startSec, true)}
                              onToggleSelect={() =>
                                toggleClipSelection(clip.id)
                              }
                              onTrim={() => openInTrim(clip)}
                              rendersBusy={renders.busyClipIds.includes(
                                clip.id,
                              )}
                              score={score}
                              selected={selectedClipIds.includes(clip.id)}
                              subtitlesAvailable={subtitlesAvailable}
                            />
                          ))}
                        </ul>
                      )}
                    </aside>
                  </div>
                </div>

                <div
                  aria-labelledby="workspace-tab-trim"
                  hidden={tab !== 'trim'}
                  id="workspace-panel-trim"
                  role="tabpanel"
                >
                  <TrimPanel
                    clips={clips}
                    currentTime={currentTime}
                    draft={draft}
                    hookClipIds={hookClipIds}
                    onLoadClip={(clip) => {
                      draft.loadClip(clip);
                      seekEpisode(clip.startSec);
                    }}
                    onPreviewRange={previewRange}
                    onSave={(mode) => void saveTrim(mode)}
                    onSeek={(seconds) => seekEpisode(seconds)}
                    saving={savingTrim}
                    totalSec={duration}
                    transcript={transcript}
                  />
                </div>
              </div>
            </div>
          </>
        ) : null}
      </main>
      <SubtitleStyleDialog onClose={requestCloseStyleDialog} open={styleOpen}>
        <SubtitleStylePanel
          catalog={subtitleStyle.catalog}
          error={subtitleStyle.error}
          onChangeStyle={subtitleStyle.patchStyle}
          onChoosePreset={subtitleStyle.choosePreset}
          onPreviewNext={
            clips.length > 0
              ? () =>
                  void previewClip(
                    clips[Math.max(previewIndex + 1, 0) % clips.length],
                    true,
                    true,
                  )
              : null
          }
          canUndo={styleChangedSinceOpen()}
          onReset={subtitleStyle.resetToPreset}
          onUndo={undoStyleChanges}
          onSave={requestCloseStyleDialog}
          selection={subtitleStyle.selection}
        />
      </SubtitleStyleDialog>
      <ConfirmDialog
        cancelLabel="Keep editing"
        confirmLabel="Change style"
        onCancel={() => setConfirmStyleChange(false)}
        onConfirm={() => {
          setConfirmStyleChange(false);
          // The old subtitled videos are deleted so new ones can be made.
          renders.discardSubtitled();
          setStyleOpen(false);
        }}
        open={confirmStyleChange}
        title="Change the subtitle style?"
        tone="warning"
      >
        The reels you already rendered with subtitles use the old style. After
        this change they will be removed, and you can render them again with the
        new style.
      </ConfirmDialog>
      <DownloadDialog
        aspect={downloadAspect}
        errorMessage={downloadError}
        fileName={downloadFileName}
        items={downloadItems}
        onAspectChange={setDownloadAspect}
        onCancel={cancelDownload}
        onClose={closeDownload}
        onConfirm={() => void runDownload()}
        onRetry={() => void runDownload()}
        onSubtitlesChange={setDownloadSubtitles}
        open={downloadIds !== null}
        phase={downloadPhase}
        progress={downloadProgress}
        progressLabel={downloadProgress?.label ?? null}
        renderCount={downloadRenderCount}
        skippedCount={downloadSkipped}
        subtitles={downloadSubtitles}
        subtitlesAvailable={subtitlesAvailable}
      />
      <AppFooter />
    </div>
  );
}
