'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  getApiErrorMessage,
  type LibrarySummary,
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
import { AppHeader } from '@/components/layout/app-header';
import { PageLoading } from '@/components/common/page-loading';
import { useToast } from '@/components/feedback';
import { VideoCard, type CardMode } from '@/components/workspace/video-card';
import {
  Button,
  Select,
  EmptyState,
  Skeleton,
} from '@/components/ui';
import { useLanguage } from '@/lib/i18n/language-context';

const POLL_INTERVAL_MS = 5000;

export default function Home() {
  const { status, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { t, language } = useLanguage();

  const [videos, setVideos] = React.useState<LibrarySummary[]>([]);
  const [loadingVideos, setLoadingVideos] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<LibraryFilter>('all');
  const [sort, setSort] = React.useState<LibrarySort>('recent');
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<CardMode>('view');
  const [draftTitle, setDraftTitle] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [router, status]);

  const loadLibrary = React.useCallback(async (initial: boolean) => {
    try {
      const data = await api.getLibrary();
      setVideos(data);
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

  React.useEffect(() => {
    if (status !== 'authenticated') return;
    const timer = window.setTimeout(() => {
      void loadLibrary(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLibrary, status]);

  const hasActiveWork = React.useMemo(() => videos.some(isInProgress), [videos]);

  React.useEffect(() => {
    if (!hasActiveWork) return;
    const timer = window.setInterval(
      () => void loadLibrary(false),
      POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [hasActiveWork, loadLibrary]);

  const counts = React.useMemo(
    () => ({
      all: videos.length,
      completed: videos.filter(isCompleted).length,
      'in-progress': videos.filter(isInProgress).length,
    }),
    [videos],
  );

  const visibleVideos = React.useMemo(
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
      toast.show({
        title: language === 'ar' ? 'تمت إعادة التسمية' : 'Video renamed',
        description: updated.title,
      });
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
      toast.show({
        title: language === 'ar' ? 'تم حذف الفيديو' : 'Video deleted',
      });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Video could not be deleted.'));
    } finally {
      setBusyId(null);
    }
  }

  if (status === 'loading') {
    return <PageLoading label={t('common.loading')} />;
  }

  if (status !== 'authenticated' || !user) {
    return null;
  }

  const tabs: { id: LibraryFilter; label: string }[] = [
    { id: 'all', label: t('workspace.allVideos') },
    { id: 'in-progress', label: t('workspace.inProgress') },
    { id: 'completed', label: t('workspace.completedReels') },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-8 py-8 space-y-8">
        {/* Header section with title and Upload action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">
              {t('workspace.title')}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {t('workspace.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/videos/new">
              <Button size="md" variant="primary">
                <span className="me-1.5 text-base leading-none">+</span>
                {t('workspace.uploadVideo')}
              </Button>
            </Link>
          </div>
        </div>

        {/* Filter Tabs & Sorting Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          {/* Filter Pills */}
          <div className="flex flex-wrap gap-1.5 p-1 bg-surface-2 border border-border rounded-lg text-xs" role="tablist">
            {tabs.map((tab) => (
              <button
                aria-selected={filter === tab.id}
                className={`px-3 py-1.5 rounded-md font-medium transition-all select-none ${
                  filter === tab.id
                    ? 'bg-surface text-text shadow-xs'
                    : 'text-muted hover:text-text'
                }`}
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}{' '}
                <span className="opacity-75 ms-1">({counts[tab.id]})</span>
              </button>
            ))}
          </div>

          {/* Sort dropdown */}
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{t('common.sort')}:</span>
            <div className="w-44">
              <Select
                onChange={(e) => setSort(e.target.value as LibrarySort)}
                value={sort}
              >
                <option value="recent">{t('workspace.recentlyUploaded')}</option>
                <option value="oldest">{t('workspace.oldestFirst')}</option>
                <option value="title">{t('workspace.titleAz')}</option>
                <option value="duration">{t('workspace.longestFirst')}</option>
              </Select>
            </div>
          </div>
        </div>

        {/* Error message banner */}
        {error && (
          <div
            className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger flex items-center justify-between"
            role="alert"
          >
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-xs underline hover:opacity-80"
            >
              {t('common.close')}
            </button>
          </div>
        )}

        {/* Library Content */}
        <div>
          {loadingVideos ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-border bg-surface p-4 space-y-3"
                >
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : visibleVideos.length === 0 ? (
            <EmptyState
              action={
                videos.length === 0 ? (
                  <Link href="/videos/new">
                    <Button variant="primary">
                      {t('workspace.uploadVideo')}
                    </Button>
                  </Link>
                ) : null
              }
              description={
                videos.length === 0
                  ? t('workspace.emptyDescription')
                  : language === 'ar'
                    ? 'لا توجد فيديوهات تطابق هذا الفلتر.'
                    : 'No videos match this filter.'
              }
              icon={
                <svg
                  className="h-8 w-8 text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              }
              title={
                videos.length === 0
                  ? t('workspace.emptyTitle')
                  : language === 'ar'
                    ? 'لا توجد نتائج'
                    : 'No videos found'
              }
            />
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
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
    </div>
  );
}
