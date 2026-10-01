'use client';

import {
  ApiError,
  api,
  getApiErrorMessage,
  type Usage,
  type UploadConstraints,
} from '@/lib/api';
import { uploadVideoInChunks } from '@/lib/chunked-upload';
import {
  SPOKEN_LANGUAGES,
  estimateRemaining,
  formatClock,
  formatFileSize,
  formatResolution,
  titleFromFileName,
  type SpokenLanguage,
} from '@/lib/upload-format';
import {
  clearPendingUpload,
  getFileFingerprint,
  loadPendingUpload,
  savePendingUpload,
  type PendingUpload,
} from '@/lib/upload-store';
import {
  validateVideoDuration,
  validateVideoFile,
} from '@/lib/video-validation';
import { readVideoPreview, type VideoPreview } from '@/lib/video-preview';
import { useAuth } from '@/components/auth/auth-provider';
import { PageLoading } from '@/components/common/page-loading';
import { AppFooter } from '@/components/layout/app-footer';
import { AppHeader } from '@/components/layout/app-header';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

type UploadState =
  'idle' | 'creating' | 'uploading' | 'confirming' | 'complete' | 'failed';

const TITLE_MAX = 255;

export function UploadVideoForm() {
  const { status } = useAuth();
  const router = useRouter();
  const abortController = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const startedAt = useRef<number>(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<VideoPreview | null>(null);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<SpokenLanguage>('ar');
  const [autoClips, setAutoClips] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(
    null,
  );
  const [transferStatus, setTransferStatus] = useState('');
  const [remaining, setRemaining] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [constraints, setConstraints] = useState<UploadConstraints | null>(
    null,
  );

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  const loadConstraints = useCallback(async () => {
    setError(null);
    try {
      setConstraints(await api.getVideoUploadConstraints());
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          'Upload settings could not be loaded.',
        ),
      );
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const timer = window.setTimeout(() => {
      void loadConstraints();
      api
        .getUsage()
        .then(setUsage)
        .catch(() => setUsage(null));
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadConstraints, status]);

  function resetFile() {
    setFile(null);
    setPreview(null);
    setTitle('');
    setPendingUpload(null);
    setProgress(0);
    setRemaining(null);
    setTransferStatus('');
    setState('idle');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function processFile(selected: File) {
    setError(null);
    setTransferStatus('');
    setState('idle');

    if (!constraints) {
      setError('Upload settings are still loading. Try again in a moment.');
      return;
    }

    const fileError = validateVideoFile(selected, constraints);
    if (fileError) {
      resetFile();
      setError(fileError);
      return;
    }

    try {
      const nextPreview = await readVideoPreview(selected);
      const durationError = validateVideoDuration(
        nextPreview.durationSec,
        constraints,
      );
      if (durationError) {
        resetFile();
        setError(durationError);
        return;
      }
      setPreview(nextPreview);
    } catch (metadataError) {
      resetFile();
      setError(
        metadataError instanceof Error
          ? metadataError.message
          : 'This video metadata could not be read.',
      );
      return;
    }

    const pending = loadPendingUpload(selected);
    setFile(selected);
    setTitle(pending?.title ?? titleFromFileName(selected.name));
    setPendingUpload(pending);
    setProgress(
      pending ? Math.round((pending.nextByte / selected.size) * 100) : 0,
    );
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) {
      resetFile();
      return;
    }
    void processFile(selected);
  }

  function dropFile(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy || !constraints) return;
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) void processFile(dropped);
  }

  async function startUpload() {
    if (!file || !title.trim() || !constraints) return;

    setError(null);
    setTransferStatus('');
    setState('creating');
    startedAt.current = currentTime();
    const controller = new AbortController();
    abortController.current = controller;

    try {
      let activeUpload = pendingUpload;
      let upload;

      if (activeUpload) {
        try {
          upload = await api.getVideoUploadSignature(activeUpload.videoId);
        } catch (signatureError) {
          if (
            !(signatureError instanceof ApiError) ||
            signatureError.status !== 404
          ) {
            throw signatureError;
          }

          clearPendingUpload(file);
          setPendingUpload(null);
          activeUpload = null;
        }
      }

      if (!activeUpload) {
        const created = await api.createVideo(title.trim(), {
          language,
          autoClips,
        });
        activeUpload = {
          fileFingerprint: getFileFingerprint(file),
          nextByte: 0,
          title: title.trim(),
          uploadId: crypto.randomUUID(),
          videoId: created.video.id,
        };
        upload = created.upload;
        savePendingUpload(activeUpload);
        setPendingUpload(activeUpload);
      }

      if (!upload) {
        throw new Error('Upload could not be prepared.');
      }
      if (!activeUpload) {
        throw new Error('Upload state was lost.');
      }
      const uploadState = activeUpload;

      if (uploadState.nextByte >= file.size) {
        setState('confirming');
        await confirmUpload(
          uploadState.videoId,
          uploadState.cloudinaryPublicId,
          controller.signal,
        );
        clearPendingUpload(file);
        setPendingUpload(null);
        setState('complete');
        return;
      }

      setState('uploading');
      const uploadedAsset = await uploadVideoInChunks(file, upload, {
        onChunkComplete: (nextByte) => {
          const nextUpload = { ...uploadState, nextByte };
          savePendingUpload(nextUpload);
          setPendingUpload(nextUpload);
        },
        onProgress: (percent) => {
          setProgress(percent);
          setRemaining(
            estimateRemaining(currentTime() - startedAt.current, percent),
          );
        },
        onRetry: (attempt) =>
          setTransferStatus(`Reconnecting (attempt ${attempt} of 3)`),
        signal: controller.signal,
        startAt: uploadState.nextByte,
        uploadId: uploadState.uploadId,
      });
      const completedUpload = {
        ...uploadState,
        cloudinaryPublicId: uploadedAsset.public_id,
      };
      savePendingUpload(completedUpload);
      setPendingUpload(completedUpload);
      setState('confirming');
      await confirmUpload(
        completedUpload.videoId,
        completedUpload.cloudinaryPublicId,
        controller.signal,
      );
      clearPendingUpload(file);
      setPendingUpload(null);
      setTransferStatus('');
      setRemaining(null);
      setState('complete');
    } catch (uploadError) {
      if (
        uploadError instanceof DOMException &&
        uploadError.name === 'AbortError'
      ) {
        setTransferStatus(
          'Upload paused. Choose this same file to resume later.',
        );
        setRemaining(null);
        setState('idle');
        return;
      }
      setState('failed');
      setError(
        getApiErrorMessage(uploadError, 'The upload could not be started.'),
      );
    } finally {
      abortController.current = null;
    }
  }

  function cancelUpload() {
    abortController.current?.abort();
  }

  async function confirmUpload(
    videoId: string,
    publicId: string | undefined,
    signal: AbortSignal,
  ) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await api.completeVideo(videoId, publicId);
        return;
      } catch (confirmError) {
        if (
          !(confirmError instanceof ApiError) ||
          confirmError.status !== 409 ||
          attempt >= 4
        ) {
          throw confirmError;
        }

        setTransferStatus('Finalizing upload. Retrying confirmation...');
        await delay(2000, signal);
      }
    }
  }

  if (status === 'loading') {
    return <PageLoading label="Loading upload page..." />;
  }

  if (status !== 'authenticated') {
    return null;
  }

  const busy =
    state === 'creating' || state === 'uploading' || state === 'confirming';
  const canResume = pendingUpload !== null;
  const resolution = formatResolution(preview?.height ?? null);
  const extension = file?.name.split('.').pop()?.toUpperCase() ?? '';
  const aiLeft = usage ? Math.max(0, usage.aiRunLimit - usage.aiRuns) : null;
  const selectedLanguage =
    SPOKEN_LANGUAGES.find((item) => item.id === language) ??
    SPOKEN_LANGUAGES[0];

  return (
    <div className="flex min-h-screen flex-col bg-[#f2f9f6] text-[#172321]">
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            className="text-sm font-medium text-[#0f766e] hover:underline"
            href="/"
          >
            ← Back to workspace
          </Link>
          {usage && aiLeft !== null ? (
            <span className="rounded-full border border-[#cfe3dc] bg-white px-3 py-1 font-mono text-[11px] text-[#5d6d68]">
              <span className="mr-1.5 text-[#10b981]">●</span>
              AI Runs Available:{' '}
              <strong className="text-[#0f766e]">
                {aiLeft} of {usage.aiRunLimit}
              </strong>{' '}
              this month
            </span>
          ) : null}
        </div>

        <h1 className="mt-6 text-3xl font-bold">Upload a podcast video</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#5d6d68]">
          Upload your full-length podcast episode to auto-generate Arabic clips,
          transcripts, and vertical reels. Your file goes straight to secure
          storage while this page tracks its progress.
        </p>

        <input
          accept={
            constraints
              ? constraints.allowedFormats
                  .map((format) => `.${format}`)
                  .join(',')
              : 'video/*'
          }
          className="sr-only"
          data-testid="video-file-input"
          disabled={busy || !constraints}
          id="video-file"
          onChange={selectFile}
          ref={fileInput}
          tabIndex={-1}
          type="file"
        />

        {file ? (
          <section
            aria-label="Selected video"
            className="mt-6 flex items-center gap-4 rounded-xl border border-[#dfe6e2] bg-white p-4"
          >
            <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-[#123b3a]">
              {preview?.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="h-full w-full object-cover"
                  src={preview.thumbnail}
                />
              ) : null}
              <span className="absolute left-1 top-1 rounded bg-[#0f766e] px-1 font-mono text-[9px] font-semibold text-white">
                {[extension, resolution].filter(Boolean).join(' · ')}
              </span>
              {preview ? (
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[9px] text-white">
                  {formatClock(preview.durationSec)}
                </span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" dir="auto">
                {file.name}
              </p>
              <p className="mt-1 text-xs text-[#5d6d68]">
                {formatFileSize(file.size)}
                {remaining ? ` · ${remaining}` : ''}
              </p>
            </div>
            <button
              aria-label="Remove video"
              className="flex h-9 w-9 items-center justify-center rounded-md text-[#5d6d68] hover:bg-[#fff2ef] hover:text-[#b42318] disabled:opacity-40"
              disabled={busy}
              onClick={resetFile}
              type="button"
            >
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
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M6 6l1 14h10l1-14" />
              </svg>
            </button>
          </section>
        ) : (
          <label
            className={`mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
              dragging
                ? 'border-[#0f766e] bg-[#e4f3ef]'
                : 'border-[#b5cbc3] bg-white hover:border-[#0f766e]'
            } ${!constraints ? 'cursor-not-allowed opacity-60' : ''}`}
            htmlFor="video-file"
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDrop={dropFile}
          >
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e4f3ef] text-2xl text-[#0f766e]"
            >
              ↑
            </span>
            <span className="mt-3 text-sm font-semibold">
              Drop your podcast video here, or click to browse
            </span>
            <span className="mt-1 text-xs text-[#5d6d68]">
              {constraints
                ? `${constraints.allowedFormats.join(', ').toUpperCase()} · up to ${formatFileSize(constraints.maxFileSizeBytes)} · up to ${Math.round(constraints.maxDurationSec / 60)} min`
                : 'Loading upload settings...'}
            </span>
          </label>
        )}

        {file ? (
          <section className="mt-5 rounded-xl border border-[#dfe6e2] bg-white p-5">
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-semibold" htmlFor="video-title">
                Video Title{' '}
                <span className="font-normal text-[#5d6d68]">
                  (for AI clip generation &amp; transcript)
                </span>
              </label>
              <span
                className="font-[family-name:var(--font-cairo)] text-[11px] text-[#5d6d68]"
                dir="rtl"
                lang="ar"
              >
                العنوان باللغة العربية
              </span>
            </div>
            <input
              className="mt-2 h-11 w-full rounded-lg border border-[#d5dcd8] px-3 text-base outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/20 disabled:bg-[#f4f6f5]"
              dir="auto"
              disabled={busy}
              id="video-title"
              maxLength={TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
            <div className="mt-1.5 flex justify-between text-[11px] text-[#5d6d68]">
              <span>Prefilled from filename. Supports Arabic and English.</span>
              <span className="font-mono">{title.length} chars</span>
            </div>

            <label
              className="mt-5 block text-sm font-semibold"
              htmlFor="video-language"
            >
              Primary Spoken Language &amp; Dialect
            </label>
            <select
              className="mt-2 h-12 w-full rounded-lg border border-[#d5dcd8] bg-[#eef8f4] px-3 text-sm font-medium outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/20 disabled:opacity-60"
              disabled={busy || canResume}
              id="video-language"
              onChange={(event) =>
                setLanguage(event.target.value as SpokenLanguage)
              }
              value={language}
            >
              {SPOKEN_LANGUAGES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <p
              className="mt-1 text-[11px] text-[#5d6d68]"
              dir={language === 'ar' ? 'rtl' : 'ltr'}
            >
              {selectedLanguage.native}
            </p>

            <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-[#e3e9e6] p-3">
              <div>
                <p className="text-sm font-semibold">
                  Automatic Arabic Hook Detection
                </p>
                <p className="mt-0.5 text-xs text-[#5d6d68]">
                  When the transcript is ready, AI picks the strongest moments
                  and creates vertical clips for you (uses 1 AI run).
                </p>
              </div>
              <button
                aria-checked={autoClips}
                aria-label="Automatic hook detection"
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${autoClips ? 'bg-[#0f766e]' : 'bg-[#c9d1cd]'} disabled:opacity-50`}
                disabled={busy || canResume}
                onClick={() => setAutoClips((value) => !value)}
                role="switch"
                type="button"
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${autoClips ? 'left-[22px]' : 'left-0.5'}`}
                />
              </button>
            </div>
            {canResume ? (
              <p className="mt-2 text-[11px] text-[#5d6d68]">
                Language and detection were saved when this upload started.
              </p>
            ) : null}
          </section>
        ) : null}

        {busy || state === 'complete' ? (
          <div
            aria-live="polite"
            className="mt-5 rounded-xl border border-[#dfe6e2] bg-white p-4"
          >
            <div className="flex justify-between text-sm font-medium">
              <span>
                {state === 'complete'
                  ? 'Uploaded'
                  : state === 'confirming'
                    ? 'Confirming upload'
                    : transferStatus || 'Uploading'}
              </span>
              <span>{progress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#dce6e1]">
              <div
                className="h-full rounded-full bg-[#0f766e] transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <p
            className="mt-5 rounded-lg border-l-2 border-[#c44932] bg-[#fff2ef] px-3 py-2 text-sm text-[#8f2f1f]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {state === 'complete' ? (
          <p className="mt-5 rounded-lg border-l-2 border-[#0f766e] bg-[#eff9f4] px-3 py-2 text-sm text-[#185c4e]">
            Video is ready.{' '}
            {autoClips
              ? 'Transcription has started and clips will be created automatically. '
              : 'Transcription has started. '}
            <Link className="font-semibold underline" href="/">
              Open your workspace
            </Link>
            .
          </p>
        ) : null}
        {state === 'idle' && canResume && file ? (
          <p className="mt-5 rounded-lg border-l-2 border-[#0f766e] bg-[#eff9f4] px-3 py-2 text-sm text-[#185c4e]">
            A previous upload was found. Continue from {progress}%.
          </p>
        ) : null}
        {state === 'idle' && transferStatus ? (
          <p className="mt-5 text-sm text-[#5d6d68]">{transferStatus}</p>
        ) : null}

        {!constraints && !busy ? (
          <button
            className="mt-5 h-10 rounded-lg border border-[#a9bab3] px-4 text-sm font-medium text-[#263532] hover:border-[#0f766e] hover:text-[#0f766e]"
            onClick={() => void loadConstraints()}
            type="button"
          >
            Retry upload settings
          </button>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          {busy ? (
            <button
              className="h-11 px-4 text-sm font-medium text-[#263532] hover:text-[#8f2f1f]"
              onClick={cancelUpload}
              type="button"
            >
              Cancel
            </button>
          ) : (
            <Link
              className="flex h-11 items-center px-4 text-sm font-medium text-[#263532] hover:text-[#0f766e]"
              href="/"
            >
              Cancel
            </Link>
          )}
          <button
            className="flex h-11 items-center gap-2 rounded-lg bg-[#0f766e] px-5 text-sm font-semibold text-white transition hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
            disabled={
              !file ||
              !title.trim() ||
              !constraints ||
              busy ||
              state === 'complete'
            }
            onClick={() => void startUpload()}
            type="button"
          >
            {state === 'creating'
              ? 'Preparing upload'
              : state === 'uploading'
                ? 'Uploading video'
                : state === 'confirming'
                  ? 'Confirming upload'
                  : canResume && pendingUpload.nextByte >= (file?.size ?? 0)
                    ? 'Confirm upload'
                    : canResume
                      ? 'Resume upload'
                      : 'Start upload'}
          </button>
        </div>

        <p className="mt-8 rounded-lg border border-[#dfe6e2] bg-white p-3 text-xs leading-5 text-[#5d6d68]">
          <strong className="text-[#172321]">Creator Tip:</strong> For the most
          accurate Arabic captions, record with a clean, isolated microphone per
          speaker. Clear audio gives the transcription model the best results.
        </p>
      </main>
      <AppFooter />
    </div>
  );
}

function currentTime(): number {
  return Date.now();
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Upload cancelled.', 'AbortError'));
      },
      { once: true },
    );
  });
}
