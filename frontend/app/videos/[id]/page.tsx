'use client';

import { useAuth } from '@/components/auth/auth-provider';
import { PageLoading } from '@/components/common/page-loading';
import { TranscriptViewer } from '@/components/videos/transcript-viewer';
import {
  api,
  getApiErrorMessage,
  type Clip,
  type LibraryVideo,
  type ProcessingJob,
  type Transcript,
} from '@/lib/api';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function VideoWorkspacePage() {
  const { status } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const player = useRef<HTMLVideoElement>(null);
  const [video, setVideo] = useState<LibraryVideo | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [clipTitle, setClipTitle] = useState('');
  const [startInput, setStartInput] = useState('0:00');
  const [endInput, setEndInput] = useState('0:00');
  const [previewEndSec, setPreviewEndSec] = useState<number | null>(null);
  const [savingClip, setSavingClip] = useState(false);
  const [creatingAiClips, setCreatingAiClips] = useState(false);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingStart, setEditingStart] = useState('0:00');
  const [editingEnd, setEditingEnd] = useState('0:00');
  const [clipActionId, setClipActionId] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
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
      api.getVideoProcessingJobs(params.id),
      api.getVideoTranscript(params.id).catch(() => null),
    ])
      .then(([videos, nextClips, playback, nextJobs, nextTranscript]) => {
        const nextVideo = videos.find((item) => item.id === params.id) ?? null;
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
        setSourceUrl(playback.url);
        setOriginalUrl(playback.url);
      })
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
  }, [params.id, status]);

  useEffect(() => {
    if (status !== 'authenticated' || !params.id) return;

    const activeJob = jobs.find(
      (j) => j.status === 'PENDING' || j.status === 'RUNNING',
    );
    if (!activeJob) return;

    const interval = setInterval(() => {
      api
        .getVideoProcessingJobs(params.id)
        .then((updatedJobs) => {
          setJobs(updatedJobs);
          const wasActive = updatedJobs.some(
            (j) => j.status === 'PENDING' || j.status === 'RUNNING',
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

  async function previewClip(clip: Clip) {
    setError(null);
    try {
      const { url } = await api.getClipPlaybackUrl(clip.id);
      setSourceUrl(url);
      setCurrentTime(0);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, 'Clip preview could not be loaded.'),
      );
    }
  }

  function seekTo(seconds: number) {
    if (!player.current) return;
    player.current.currentTime = seconds;
    setCurrentTime(seconds);
    void player.current.play().catch(() => undefined);
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

  function setDraftTime(field: 'start' | 'end') {
    if (field === 'start') setStartInput(formatTime(currentTime));
    else setEndInput(formatTime(currentTime));
  }

  function previewDraft() {
    const startSec = parseTime(startInput);
    const endSec = parseTime(endInput);
    if (
      startSec === null ||
      endSec === null ||
      endSec <= startSec ||
      !originalUrl
    ) {
      setError('Enter a valid start and end time before previewing the range.');
      return;
    }
    setError(null);
    setSourceUrl(originalUrl);
    setPreviewEndSec(endSec);
    window.setTimeout(() => seekTo(startSec), 0);
  }

  async function saveClip() {
    const startSec = parseTime(startInput);
    const endSec = parseTime(endInput);
    if (startSec === null || endSec === null || !clipTitle.trim()) {
      setError('Enter a title, start time and end time for the clip.');
      return;
    }
    setSavingClip(true);
    setError(null);
    try {
      const created = await api.createClip(params.id, {
        title: clipTitle.trim(),
        startSec,
        endSec,
      });
      setClips((current) =>
        [...current, created].sort((a, b) => a.startSec - b.startSec),
      );
      setClipTitle('');
      setPreviewEndSec(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Clip could not be created.'));
    } finally {
      setSavingClip(false);
    }
  }

  async function createAiClips() {
    if (!params.id) return;
    setCreatingAiClips(true);
    setError(null);
    try {
      const created = await api.createAiClips(params.id);
      setClips((current) =>
        [...current, ...created].sort((a, b) => a.startSec - b.startSec),
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          'AI clip suggestions could not be created.',
        ),
      );
    } finally {
      setCreatingAiClips(false);
    }
  }

  function beginEdit(clip: Clip) {
    setEditingClipId(clip.id);
    setEditingTitle(clip.title);
    setEditingStart(formatTime(clip.startSec));
    setEditingEnd(formatTime(clip.endSec));
    setError(null);
  }

  async function saveEdit(clipId: string) {
    const startSec = parseTime(editingStart);
    const endSec = parseTime(editingEnd);
    if (startSec === null || endSec === null || !editingTitle.trim()) {
      setError('Enter a title, start time and end time for the clip.');
      return;
    }
    setClipActionId(clipId);
    setError(null);
    try {
      const updated = await api.updateClip(clipId, {
        title: editingTitle.trim(),
        startSec,
        endSec,
      });
      setClips((current) =>
        current
          .map((clip) => (clip.id === updated.id ? updated : clip))
          .sort((a, b) => a.startSec - b.startSec),
      );
      setEditingClipId(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Clip could not be updated.'));
    } finally {
      setClipActionId(null);
    }
  }

  async function deleteClip(clip: Clip) {
    if (!window.confirm(`Delete "${clip.title}"? This cannot be undone.`))
      return;
    setClipActionId(clip.id);
    setError(null);
    try {
      await api.deleteClip(clip.id);
      setClips((current) => current.filter((item) => item.id !== clip.id));
      if (editingClipId === clip.id) setEditingClipId(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Clip could not be deleted.'));
    } finally {
      setClipActionId(null);
    }
  }

  async function splitClip(clip: Clip) {
    setClipActionId(clip.id);
    setError(null);
    try {
      const split = await api.splitClip(clip.id, currentTime);
      setClips((current) =>
        current
          .filter((item) => item.id !== clip.id)
          .concat(split)
          .sort((a, b) => a.startSec - b.startSec),
      );
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Clip could not be split.'));
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

  async function downloadClip(clipId: string) {
    setClipActionId(clipId);
    setError(null);
    try {
      const { url } = await api.getClipDownloadUrl(clipId);
      window.location.assign(url);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, 'Clip download could not be started.'),
      );
    } finally {
      setClipActionId(null);
    }
  }

  if (status === 'loading') {
    return <PageLoading label="Loading video workspace..." />;
  }

  if (status !== 'authenticated') {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-[#172321]">
      <section className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <Link className="text-sm font-medium text-[#0f766e] underline" href="/">
          Back to workspace
        </Link>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[#0f766e]">Video editor</p>
            <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
              {video?.title ?? 'Video workspace'}
            </h1>
          </div>
          {video?.durationSec ? (
            <span className="text-sm text-[#5f6e69]">
              {formatTime(video.durationSec)} total duration
            </span>
          ) : null}
        </div>

        {jobs.length > 0 ? (
          <div className="mt-6 border border-[#d8e1dc] bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Processing Status</h2>
            <div className="mt-2 space-y-2">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="font-medium">{job.type}</span>
                  <div className="flex items-center gap-4">
                    {job.status === 'RUNNING' && (
                      <span className="text-[#0f766e] font-mono">
                        {job.progress}%
                      </span>
                    )}
                    <span
                      className={`px-2 py-1 text-xs font-semibold uppercase tracking-wide
                      ${job.status === 'COMPLETED' ? 'bg-[#dce6e1] text-[#0b615b]' : ''}
                      ${job.status === 'FAILED' ? 'bg-[#fff2ef] text-[#c44932]' : ''}
                      ${job.status === 'RUNNING' ? 'bg-[#e6f4f1] text-[#0f766e]' : ''}
                      ${job.status === 'PENDING' ? 'bg-gray-100 text-gray-600' : ''}
                    `}
                    >
                      {job.status}
                    </span>
                    {job.status === 'FAILED' && (
                      <button
                        onClick={() =>
                          api
                            .startTranscription(params.id)
                            .then(() =>
                              api
                                .getVideoProcessingJobs(params.id)
                                .then(setJobs),
                            )
                        }
                        className="text-[#0f766e] underline hover:text-[#0b615b]"
                        type="button"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <p
            className="mt-8 border-l-2 border-[#c44932] bg-[#fff2ef] px-3 py-2 text-sm text-[#8f2f1f]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="mt-10 text-sm text-[#5f6e69]">
            Loading video workspace...
          </p>
        ) : null}

        {video && !loading ? (
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_18rem]">
            <div>
              <div className="aspect-video overflow-hidden bg-[#172321]">
                {sourceUrl ? (
                  <video
                    className="h-full w-full"
                    controls
                    onTimeUpdate={(event) => {
                      const nextTime = event.currentTarget.currentTime;
                      setCurrentTime(nextTime);
                      if (previewEndSec !== null && nextTime >= previewEndSec) {
                        event.currentTarget.pause();
                        setPreviewEndSec(null);
                      }
                    }}
                    ref={player}
                    src={sourceUrl}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-8 text-center text-sm text-[#dce6e1]">
                    Select a clip from the timeline to preview it.
                  </div>
                )}
              </div>

              <section
                className="mt-8 border-y border-[#d8e1dc] py-5"
                aria-label="Clip timeline"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-base font-semibold">Timeline</h2>
                  <span className="font-mono text-sm text-[#5f6e69]">
                    {formatTime(currentTime)} /{' '}
                    {formatTime(video.durationSec ?? 0)}
                  </span>
                </div>
                <div className="relative mt-5 h-12 bg-[#dce6e1]">
                  {clips.map((clip) => {
                    const start =
                      (clip.startSec / (video.durationSec ?? 1)) * 100;
                    const width =
                      ((clip.endSec - clip.startSec) /
                        (video.durationSec ?? 1)) *
                      100;
                    return (
                      <button
                        aria-label={`Preview ${clip.title}`}
                        className="absolute inset-y-1 bg-[#0f766e] px-1 text-left text-xs font-semibold text-white hover:bg-[#0b615b] focus:outline-none focus:ring-2 focus:ring-[#172321]"
                        key={clip.id}
                        onClick={() => void previewClip(clip)}
                        style={{ left: `${start}%`, width: `${width}%` }}
                        type="button"
                      >
                        <span className="sr-only">{clip.title}</span>
                      </button>
                    );
                  })}
                  <div
                    aria-hidden="true"
                    className="absolute inset-y-0 w-0.5 bg-[#c44932]"
                    style={{
                      left: `${(currentTime / (video.durationSec ?? 1)) * 100}%`,
                    }}
                  />
                </div>
                {clips.length === 0 ? (
                  <p className="mt-3 text-sm text-[#5f6e69]">
                    No clips yet. Create your first range from the player
                    controls.
                  </p>
                ) : null}
              </section>

              <section className="mt-8 border-b border-[#d8e1dc] pb-8">
                <h2 className="text-base font-semibold">Create clip</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label
                    className="text-sm font-medium sm:col-span-2"
                    htmlFor="clip-title"
                  >
                    Clip title
                    <input
                      className="mt-2 h-10 w-full border border-[#a9bab3] bg-white px-3 text-sm outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/20"
                      id="clip-title"
                      onChange={(event) => setClipTitle(event.target.value)}
                      value={clipTitle}
                    />
                  </label>
                  <TimeField
                    id="clip-start"
                    label="Start"
                    value={startInput}
                    onChange={setStartInput}
                    onSet={() => setDraftTime('start')}
                  />
                  <TimeField
                    id="clip-end"
                    label="End"
                    value={endInput}
                    onChange={setEndInput}
                    onSet={() => setDraftTime('end')}
                  />
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    className="h-10 border border-[#a9bab3] px-4 text-sm font-medium hover:border-[#0f766e] hover:text-[#0f766e]"
                    onClick={previewDraft}
                    type="button"
                  >
                    Preview range
                  </button>
                  <button
                    className="h-10 bg-[#0f766e] px-4 text-sm font-semibold text-white hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
                    disabled={savingClip}
                    onClick={() => void saveClip()}
                    type="button"
                  >
                    {savingClip ? 'Saving clip' : 'Save clip'}
                  </button>
                </div>
              </section>
            </div>

            <div className="border-t border-[#d8e1dc] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <TranscriptViewer
                transcript={transcript}
                currentTime={currentTime}
                onSeek={seekTo}
                onTranscribe={() => void handleStartTranscription()}
                isTranscribing={jobs.some(
                  (j) => j.status === 'PENDING' || j.status === 'RUNNING',
                )}
              />
              {transcript?.segments.length ? (
                <button
                  className="mt-5 h-10 w-full bg-[#0f766e] px-4 text-sm font-semibold text-white hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
                  disabled={creatingAiClips}
                  onClick={() => void createAiClips()}
                  type="button"
                >
                  {creatingAiClips ? 'Creating AI clips' : 'Create AI clips'}
                </button>
              ) : null}
            </div>

            <aside className="border-t border-[#d8e1dc] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Existing clips</h2>
                {selectedClipIds.length >= 2 ? (
                  <button
                    className="h-8 bg-[#0f766e] px-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
                    disabled={clipActionId !== null}
                    onClick={() => void mergeSelectedClips()}
                    type="button"
                  >
                    {clipActionId === 'merge' ? 'Merging' : 'Merge selected'}
                  </button>
                ) : null}
              </div>
              {clips.length === 0 ? (
                <p className="mt-3 text-sm text-[#5f6e69]">No saved clips.</p>
              ) : (
                <ul className="mt-4 divide-y divide-[#d8e1dc]">
                  {clips.map((clip) => {
                    const editing = editingClipId === clip.id;
                    const busy = clipActionId === clip.id;
                    return (
                      <li className="py-3" key={clip.id}>
                        {editing ? (
                          <div className="space-y-2">
                            <input
                              aria-label="Clip title"
                              className="h-9 w-full border border-[#0f766e] px-2 text-sm outline-none ring-2 ring-[#0f766e]/20"
                              disabled={busy}
                              onChange={(event) =>
                                setEditingTitle(event.target.value)
                              }
                              value={editingTitle}
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                aria-label="Clip start time"
                                className="h-9 min-w-0 border border-[#a9bab3] px-2 font-mono text-sm"
                                disabled={busy}
                                onChange={(event) =>
                                  setEditingStart(event.target.value)
                                }
                                value={editingStart}
                              />
                              <input
                                aria-label="Clip end time"
                                className="h-9 min-w-0 border border-[#a9bab3] px-2 font-mono text-sm"
                                disabled={busy}
                                onChange={(event) =>
                                  setEditingEnd(event.target.value)
                                }
                                value={editingEnd}
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                className="h-8 bg-[#0f766e] px-3 text-xs font-semibold text-white disabled:opacity-50"
                                disabled={busy}
                                onClick={() => void saveEdit(clip.id)}
                                type="button"
                              >
                                Save
                              </button>
                              <button
                                className="h-8 border border-[#a9bab3] px-3 text-xs font-medium"
                                disabled={busy}
                                onClick={() => setEditingClipId(null)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <label className="flex min-w-0 items-start gap-2">
                                <input
                                  aria-label={`Select ${clip.title} for merge`}
                                  checked={selectedClipIds.includes(clip.id)}
                                  disabled={busy}
                                  onChange={() => toggleClipSelection(clip.id)}
                                  type="checkbox"
                                />
                                <button
                                  className="min-w-0 text-left text-sm font-semibold text-[#172321] hover:text-[#0f766e]"
                                  onClick={() => void previewClip(clip)}
                                  type="button"
                                >
                                  {clip.title}
                                </button>
                              </label>
                              <span className="shrink-0 text-xs font-medium text-[#5f6e69]">
                                {clip.source === 'AI' ? 'AI' : 'Manual'}
                              </span>
                            </div>
                            <button
                              className="mt-1 text-sm text-[#0f766e] underline"
                              onClick={() => seekTo(clip.startSec)}
                              type="button"
                            >
                              {formatTime(clip.startSec)} -{' '}
                              {formatTime(clip.endSec)}
                            </button>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                className="h-8 border border-[#a9bab3] px-2 text-xs font-medium hover:border-[#0f766e]"
                                disabled={busy}
                                onClick={() => beginEdit(clip)}
                                type="button"
                              >
                                Edit
                              </button>
                              <button
                                className="h-8 border border-[#a9bab3] px-2 text-xs font-medium hover:border-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={
                                  busy ||
                                  currentTime - clip.startSec < 5 ||
                                  clip.endSec - currentTime < 5
                                }
                                onClick={() => void splitClip(clip)}
                                type="button"
                              >
                                Split here
                              </button>
                              <button
                                className="h-8 border border-[#a9bab3] px-2 text-xs font-medium hover:border-[#0f766e]"
                                disabled={busy}
                                onClick={() => void downloadClip(clip.id)}
                                type="button"
                              >
                                Download
                              </button>
                              <button
                                className="h-8 border border-[#d5a49a] px-2 text-xs font-medium text-[#8f2f1f] hover:border-[#c44932]"
                                disabled={busy}
                                onClick={() => void deleteClip(clip)}
                                type="button"
                              >
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function parseTime(value: string): number | null {
  const match = /^(\d+):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return seconds < 60 ? minutes * 60 + seconds : null;
}

function TimeField({
  id,
  label,
  value,
  onChange,
  onSet,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSet: () => void;
}) {
  return (
    <label className="text-sm font-medium" htmlFor={id}>
      {label}
      <div className="mt-2 flex gap-2">
        <input
          className="h-10 min-w-0 flex-1 border border-[#a9bab3] bg-white px-3 font-mono text-sm outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/20"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
        <button
          className="h-10 border border-[#a9bab3] px-3 text-sm font-medium hover:border-[#0f766e]"
          onClick={onSet}
          type="button"
        >
          Set
        </button>
      </div>
    </label>
  );
}
