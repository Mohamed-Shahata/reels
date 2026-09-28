'use client';

import { ApiError, api } from '@/lib/api';
import { uploadVideoInChunks } from '@/lib/chunked-upload';
import {
  clearPendingUpload,
  getFileFingerprint,
  loadPendingUpload,
  savePendingUpload,
  type PendingUpload,
} from '@/lib/upload-store';
import {
  readVideoDuration,
  validateVideoDuration,
  validateVideoFile,
} from '@/lib/video-validation';
import { useAuth } from '@/components/auth/auth-provider';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import type { UploadConstraints } from '@/lib/api';

type UploadState =
  'idle' | 'creating' | 'uploading' | 'confirming' | 'complete' | 'failed';

function titleFromFile(file: File): string {
  return file.name.replace(/\.[^.]+$/, '') || 'Untitled video';
}

export function UploadVideoForm() {
  const { status } = useAuth();
  const router = useRouter();
  const abortController = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(
    null,
  );
  const [transferStatus, setTransferStatus] = useState('');
  const [constraints, setConstraints] = useState<UploadConstraints | null>(
    null,
  );

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    api
      .getVideoUploadConstraints()
      .then(setConstraints)
      .catch(() => setError('Upload settings could not be loaded.'));
  }, [status]);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;

    setError(null);
    setTransferStatus('');
    setState('idle');

    if (!selected) {
      setFile(null);
      setTitle('');
      setPendingUpload(null);
      setProgress(0);
      return;
    }

    if (!constraints) {
      event.target.value = '';
      setError('Upload settings are still loading. Try again in a moment.');
      return;
    }

    const fileError = validateVideoFile(selected, constraints);
    if (fileError) {
      event.target.value = '';
      setFile(null);
      setPendingUpload(null);
      setProgress(0);
      setError(fileError);
      return;
    }

    try {
      const durationError = validateVideoDuration(
        await readVideoDuration(selected),
        constraints,
      );
      if (durationError) {
        event.target.value = '';
        setFile(null);
        setPendingUpload(null);
        setProgress(0);
        setError(durationError);
        return;
      }
    } catch (metadataError) {
      event.target.value = '';
      setFile(null);
      setPendingUpload(null);
      setProgress(0);
      setError(
        metadataError instanceof Error
          ? metadataError.message
          : 'This video metadata could not be read.',
      );
      return;
    }

    const pending = selected ? loadPendingUpload(selected) : null;
    setFile(selected);
    setTitle(pending?.title ?? (selected ? titleFromFile(selected) : ''));
    setPendingUpload(pending);
    setProgress(
      pending && selected
        ? Math.round((pending.nextByte / selected.size) * 100)
        : 0,
    );
  }

  async function startUpload() {
    if (!file || !title.trim() || !constraints) return;

    setError(null);
    setTransferStatus('');
    setState('creating');
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
        const created = await api.createVideo(title.trim());
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
        onProgress: setProgress,
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
      setState('complete');
    } catch (uploadError) {
      if (
        uploadError instanceof DOMException &&
        uploadError.name === 'AbortError'
      ) {
        setTransferStatus(
          'Upload paused. Choose this same file to resume later.',
        );
        setState('idle');
        return;
      }
      setState('failed');
      setError(
        uploadError instanceof ApiError
          ? uploadError.message
          : uploadError instanceof Error
            ? uploadError.message
            : 'The upload could not be started.',
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

  if (status !== 'authenticated') {
    return <main className="min-h-screen bg-[#f6f8f7]" />;
  }

  const busy =
    state === 'creating' || state === 'uploading' || state === 'confirming';
  const canResume = pendingUpload !== null;

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-[#172321]">
      <header className="flex min-h-16 items-center border-b border-[#d8e1dc] bg-white px-5 sm:px-8">
        <Link
          className="text-sm font-semibold tracking-[0.16em] text-[#123b3a]"
          href="/"
        >
          PODCAST REELS
        </Link>
      </header>
      <section className="mx-auto max-w-3xl px-5 py-12 sm:px-8">
        <Link
          className="text-sm font-medium text-[#0f766e] underline underline-offset-4"
          href="/"
        >
          Back to workspace
        </Link>
        <h1 className="mt-6 text-3xl font-semibold">Upload a podcast video</h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-[#5f6e69]">
          Your file is sent directly to secure storage while this page tracks
          its progress.
        </p>

        <div className="mt-10 border border-[#d8e1dc] bg-white p-5 sm:p-7">
          <label className="block text-sm font-medium" htmlFor="video-file">
            Video file
            <input
              accept={
                constraints
                  ? constraints.allowedFormats
                      .map((format) => `.${format}`)
                      .join(',')
                  : 'video/*'
              }
              className="mt-2 block w-full cursor-pointer border border-dashed border-[#9fb1a9] bg-[#f8faf9] px-3 py-7 text-sm text-[#465852] file:mr-4 file:border-0 file:bg-[#d9eee6] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[#123b3a]"
              disabled={busy || !constraints}
              id="video-file"
              onChange={selectFile}
              type="file"
            />
          </label>

          <label
            className="mt-6 block text-sm font-medium"
            htmlFor="video-title"
          >
            Video title
            <input
              className="mt-2 h-11 w-full border border-[#bcc8c2] px-3 outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/20"
              disabled={busy}
              id="video-title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </label>

          {file ? (
            <p className="mt-3 text-sm text-[#5f6e69]">
              {file.name} - {(file.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          ) : null}

          {busy || state === 'complete' ? (
            <div className="mt-7" aria-live="polite">
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
              <div className="mt-2 h-2 overflow-hidden bg-[#dce6e1]">
                <div
                  className="h-full bg-[#0f766e] transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p
              className="mt-6 border-l-2 border-[#c44932] bg-[#fff2ef] px-3 py-2 text-sm text-[#8f2f1f]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {state === 'complete' ? (
            <p className="mt-6 border-l-2 border-[#0f766e] bg-[#eff9f4] px-3 py-2 text-sm text-[#185c4e]">
              Upload received. It will be confirmed in the next processing step.
            </p>
          ) : null}
          {state === 'idle' && canResume ? (
            <p className="mt-6 border-l-2 border-[#0f766e] bg-[#eff9f4] px-3 py-2 text-sm text-[#185c4e]">
              A previous upload was found. Continue from {progress}%.
            </p>
          ) : null}
          {state === 'idle' && transferStatus ? (
            <p className="mt-6 text-sm text-[#5f6e69]">{transferStatus}</p>
          ) : null}

          <div className="mt-7 flex flex-wrap gap-3">
            <button
              className="h-11 bg-[#0f766e] px-5 text-sm font-semibold text-white transition hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
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
            {busy ? (
              <button
                className="h-11 border border-[#a9bab3] px-4 text-sm font-medium text-[#263532] hover:border-[#c44932] hover:text-[#8f2f1f]"
                onClick={cancelUpload}
                type="button"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
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
