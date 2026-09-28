'use client';

import { api, getApiErrorMessage, type LibraryVideo } from '@/lib/api';
import { clearPendingUploadByVideoId } from '@/lib/upload-store';
import { useAuth } from '@/components/auth/auth-provider';
import { PageLoading } from '@/components/common/page-loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Home() {
  const { logout, status, user } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    api
      .getVideos()
      .then(setVideos)
      .catch((requestError) => {
        setError(
          getApiErrorMessage(requestError, 'Videos could not be loaded.'),
        );
      })
      .finally(() => setLoadingVideos(false));
  }, [status]);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    router.replace('/login');
  }

  function beginRename(video: LibraryVideo) {
    setEditingId(video.id);
    setDraftTitle(video.title);
    setError(null);
  }

  async function saveRename(videoId: string) {
    const title = draftTitle.trim();
    if (!title) return;

    setSavingId(videoId);
    setError(null);
    try {
      const updated = await api.renameVideo(videoId, title);
      setVideos((current) =>
        current.map((video) => (video.id === videoId ? updated : video)),
      );
      setEditingId(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Video could not be renamed.'));
    } finally {
      setSavingId(null);
    }
  }

  async function removeVideo(video: LibraryVideo) {
    if (!window.confirm(`Delete "${video.title}"? This cannot be undone.`)) {
      return;
    }

    setSavingId(video.id);
    setError(null);
    try {
      await api.deleteVideo(video.id);
      clearPendingUploadByVideoId(video.id);
      setVideos((current) => current.filter((item) => item.id !== video.id));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Video could not be deleted.'));
    } finally {
      setSavingId(null);
    }
  }

  if (status === 'loading') {
    return <PageLoading label="Loading workspace..." />;
  }

  if (status !== 'authenticated' || !user) {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-[#172321]">
      <header className="flex min-h-16 items-center justify-between border-b border-[#d8e1dc] bg-white px-5 sm:px-8">
        <span className="text-sm font-semibold tracking-[0.16em] text-[#123b3a]">
          PODCAST REELS
        </span>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-[#5f6e69] sm:inline">
            {user.email}
          </span>
          <button
            className="h-9 border border-[#a9bab3] px-3 text-sm font-medium text-[#263532] transition hover:border-[#0f766e] hover:text-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loggingOut}
            onClick={() => void handleLogout()}
            type="button"
          >
            {loggingOut ? 'Signing out' : 'Sign out'}
          </button>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
        <div className="w-full">
          <p className="text-sm font-medium text-[#0f766e]">Workspace</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="text-3xl font-semibold sm:text-4xl">
                Your videos
              </h1>
              <p className="mt-3 text-base text-[#5f6e69]">
                Upload a podcast to start creating clips.
              </p>
            </div>
            <Link
              className="inline-flex h-11 items-center bg-[#0f766e] px-5 text-sm font-semibold text-white transition hover:bg-[#0b615b]"
              href="/videos/new"
            >
              Upload video
            </Link>
          </div>
          {error ? (
            <p
              className="mt-8 border-l-2 border-[#c44932] bg-[#fff2ef] px-3 py-2 text-sm text-[#8f2f1f]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <div className="mt-12 border-t border-[#d8e1dc]">
            {loadingVideos ? (
              <p className="py-10 text-sm text-[#5f6e69]">Loading videos...</p>
            ) : videos.length === 0 ? (
              <p className="py-10 text-sm text-[#5f6e69]">
                No videos uploaded yet.
              </p>
            ) : (
              <ul>
                {videos.map((video) => {
                  const editing = editingId === video.id;
                  const saving = savingId === video.id;

                  return (
                    <li
                      className="grid gap-4 border-b border-[#d8e1dc] py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                      key={video.id}
                    >
                      <div className="min-w-0">
                        {editing ? (
                          <input
                            aria-label="Video title"
                            className="h-10 w-full max-w-xl border border-[#0f766e] px-3 text-base font-semibold outline-none ring-2 ring-[#0f766e]/20"
                            disabled={saving}
                            onChange={(event) =>
                              setDraftTitle(event.target.value)
                            }
                            value={draftTitle}
                          />
                        ) : video.status === 'READY' ? (
                          <Link
                            className="block truncate text-lg font-semibold hover:text-[#0f766e]"
                            href={`/videos/${video.id}`}
                          >
                            {video.title}
                          </Link>
                        ) : (
                          <h2 className="truncate text-lg font-semibold">
                            {video.title}
                          </h2>
                        )}
                        <p className="mt-1 text-sm text-[#5f6e69]">
                          {formatStatus(video.status)} ·{' '}
                          {formatDate(video.createdAt)}
                          {video.durationSec
                            ? ` · ${formatDuration(video.durationSec)}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {editing ? (
                          <>
                            <button
                              className="h-9 bg-[#0f766e] px-3 text-sm font-semibold text-white disabled:opacity-50"
                              disabled={saving || !draftTitle.trim()}
                              onClick={() => void saveRename(video.id)}
                              type="button"
                            >
                              Save
                            </button>
                            <button
                              className="h-9 border border-[#a9bab3] px-3 text-sm font-medium text-[#263532]"
                              disabled={saving}
                              onClick={() => setEditingId(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="h-9 border border-[#a9bab3] px-3 text-sm font-medium text-[#263532] hover:border-[#0f766e] hover:text-[#0f766e] disabled:opacity-50"
                              disabled={saving}
                              onClick={() => beginRename(video)}
                              type="button"
                            >
                              Rename
                            </button>
                            <button
                              className="h-9 border border-[#d5a49a] px-3 text-sm font-medium text-[#8f2f1f] hover:border-[#c44932] disabled:opacity-50"
                              disabled={saving}
                              onClick={() => void removeVideo(video)}
                              type="button"
                            >
                              {saving ? 'Deleting' : 'Delete'}
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function formatStatus(status: LibraryVideo['status']): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatDuration(durationSec: number): string {
  const minutes = Math.floor(durationSec / 60);
  const seconds = Math.floor(durationSec % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
