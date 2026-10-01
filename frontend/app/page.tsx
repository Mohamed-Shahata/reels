'use client';

import {
  api,
  getApiErrorMessage,
  type LibrarySummary,
  type Usage,
} from '@/lib/api';
import {
  filterVideos,
  isCompleted,
  isInProgress,
  sortVideos,
  type LibraryFilter,
  type LibrarySort,
} from '@/lib/library-filters';
import { clearPendingUploadByVideoId } from '@/lib/upload-store';
import { useAuth } from '@/components/auth/auth-provider';
import { AppFooter } from '@/components/layout/app-footer';
import { AppHeader } from '@/components/layout/app-header';
import { PageLoading } from '@/components/common/page-loading';
import {
  AlertBanner,
  EmptyState,
  LibrarySkeleton,
  useToast,
} from '@/components/feedback';
import { VideoCard, type CardMode } from '@/components/workspace/video-card';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

const POLL_INTERVAL_MS = 5000;

export default function Home() {
  const { status, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [videos, setVideos] = useState<LibrarySummary[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<CardMode>('view');
  const [draftTitle, setDraftTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [router, status]);

  const loadLibrary = useCallback(async (initial: boolean) => {
    try {
      setVideos(await api.getLibrary());
      if (initial) setError(null);
    } catch (requestError) {
      if (initial) {
        setError(
          getApiErrorMessage(requestError, 'Videos could not be loaded.'),
        );
      }
    } finally {
      if (initial) setLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const timer = window.setTimeout(() => {
      void loadLibrary(true);
      api
        .getUsage()
        .then(setUsage)
        .catch(() => setUsage(null));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLibrary, status]);

  const hasActiveWork = useMemo(() => videos.some(isInProgress), [videos]);

  useEffect(() => {
    if (!hasActiveWork) return;
    const timer = window.setInterval(
      () => void loadLibrary(false),
      POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [hasActiveWork, loadLibrary]);

  const counts = useMemo(
    () => ({
      all: videos.length,
      completed: videos.filter(isCompleted).length,
      'in-progress': videos.filter(isInProgress).length,
    }),
    [videos],
  );

  const visibleVideos = useMemo(
    () => sortVideos(filterVideos(videos, filter), sort),
    [filter, sort, videos],
  );

  function resetCard() {
    setActiveId(null);
    setMode('view');
    setDraftTitle('');
  }

  function beginRename(video: LibrarySummary) {
    setActiveId(video.id);
    setMode('renaming');
    setDraftTitle(video.title);
    setError(null);
  }

  function beginDelete(video: LibrarySummary) {
    setActiveId(video.id);
    setMode('confirming-delete');
    setError(null);
  }

  async function saveRename(videoId: string) {
    const title = draftTitle.trim();
    if (!title) return;

    setBusyId(videoId);
    setError(null);
    try {
      const updated = await api.renameVideo(videoId, title);
      setVideos((current) =>
        current.map((video) =>
          video.id === videoId ? { ...video, title: updated.title } : video,
        ),
      );
      resetCard();
      toast.show({ title: 'Video renamed', description: updated.title });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Video could not be renamed.'));
    } finally {
      setBusyId(null);
    }
  }

  async function removeVideo(videoId: string) {
    setBusyId(videoId);
    setError(null);
    try {
      await api.deleteVideo(videoId);
      clearPendingUploadByVideoId(videoId);
      setVideos((current) => current.filter((video) => video.id !== videoId));
      resetCard();
      toast.show({ title: 'Video deleted' });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Video could not be deleted.'));
    } finally {
      setBusyId(null);
    }
  }

  if (status === 'loading') {
    return <PageLoading label="Loading workspace..." />;
  }

  if (status !== 'authenticated' || !user) {
    return null;
  }

  const aiPercent = usage
    ? Math.min(100, Math.round((usage.aiRuns / usage.aiRunLimit) * 100))
    : 0;

  const tabs: { id: LibraryFilter; label: string }[] = [
    { id: 'all', label: 'All Videos' },
    { id: 'completed', label: 'Completed Reels' },
    { id: 'in-progress', label: 'In Progress' },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[#f2f9f6] text-[#172321]">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
        <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[#0f766e]">
          WORKSPACE
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-3xl font-bold">Your videos</h1>
            <p className="mt-2 text-sm text-[#5d6d68]">
              Convert Arabic episodes and streams into high-impact 9:16 vertical
              shorts.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {usage ? (
              <div className="min-w-44 rounded-lg border border-[#dfe6e2] bg-white px-3 py-2">
                <div className="flex items-center justify-between font-mono text-[10px] text-[#5d6d68]">
                  <span>AI runs this month</span>
                  <span className="font-semibold text-[#172321]">
                    {usage.aiRuns} of {usage.aiRunLimit}
                  </span>
                </div>
                <div
                  aria-label="AI runs used this month"
                  aria-valuemax={usage.aiRunLimit}
                  aria-valuemin={0}
                  aria-valuenow={usage.aiRuns}
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e3e9e6]"
                  role="progressbar"
                >
                  <div
                    className="h-full rounded-full bg-[#0f766e]"
                    style={{ width: `${aiPercent}%` }}
                  />
                </div>
              </div>
            ) : null}
            <Link
              className="inline-flex h-11 items-center rounded-lg bg-[#0f766e] px-5 text-sm font-semibold text-white transition hover:bg-[#0b615b]"
              href="/videos/new"
            >
              Upload video
            </Link>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="tablist">
            {tabs.map((tab) => (
              <button
                aria-selected={filter === tab.id}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  filter === tab.id
                    ? 'border-[#0f766e] bg-[#0f766e] text-white'
                    : 'border-[#d5dcd8] bg-white text-[#263532] hover:border-[#0f766e]'
                }`}
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label} ({counts[tab.id]})
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-[#5d6d68]">
            Sort by:
            <select
              className="h-8 rounded-md border border-[#d5dcd8] bg-white px-2 text-xs font-medium text-[#172321]"
              onChange={(event) => setSort(event.target.value as LibrarySort)}
              value={sort}
            >
              <option value="recent">Recently Uploaded</option>
              <option value="oldest">Oldest First</option>
              <option value="title">Title (A–Z)</option>
              <option value="duration">Longest First</option>
            </select>
          </label>
        </div>

        {error ? (
          <AlertBanner
            className="mt-5"
            onDismiss={() => setError(null)}
            title="Something went wrong"
          >
            {error}
          </AlertBanner>
        ) : null}

        <div className="mt-6">
          {loadingVideos ? (
            <LibrarySkeleton />
          ) : visibleVideos.length === 0 ? (
            <EmptyState
              action={
                videos.length === 0 ? (
                  <Link
                    className="inline-flex h-10 items-center rounded-lg bg-[#0f766e] px-4 text-sm font-semibold text-white"
                    href="/videos/new"
                  >
                    Upload video
                  </Link>
                ) : null
              }
              description={
                videos.length === 0
                  ? 'Upload a podcast to start creating reels.'
                  : 'Try another tab to see the rest of your library.'
              }
              title={
                videos.length === 0
                  ? 'No videos uploaded yet'
                  : 'No videos match this filter'
              }
            />
          ) : (
            <ul className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {visibleVideos.map((video) => (
                <VideoCard
                  busy={busyId === video.id}
                  draftTitle={draftTitle}
                  key={video.id}
                  mode={activeId === video.id ? mode : 'view'}
                  onBeginDelete={() => beginDelete(video)}
                  onBeginRename={() => beginRename(video)}
                  onCancel={resetCard}
                  onConfirmDelete={() => void removeVideo(video.id)}
                  onDraftChange={setDraftTitle}
                  onSaveRename={() => void saveRename(video.id)}
                  video={video}
                />
              ))}
            </ul>
          )}
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
