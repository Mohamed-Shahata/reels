'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  api,
  getApiErrorMessage,
  type UploadConstraints,
} from '@/lib/api';
import { uploadVideoInChunks } from '@/lib/chunked-upload';
import {
  estimateRemaining,
  formatFileSize,
  formatResolution,
  formatClock,
  titleFromFileName,
  getTimestamp,
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
import { AppHeader } from '@/components/layout/app-header';
import {
  Button,
  Input,
  Select,
  Switch,
  Progress,
  Badge,
} from '@/components/ui';
import { useLanguage } from '@/lib/i18n/language-context';

type UploadState =
  | 'idle'
  | 'creating'
  | 'uploading'
  | 'confirming'
  | 'complete'
  | 'failed';

const TITLE_MAX = 255;

export function UploadVideoForm() {
  const { status } = useAuth();
  const router = useRouter();
  const { t, language } = useLanguage();

  const abortController = React.useRef<AbortController | null>(null);
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const startedAt = React.useRef<number>(0);

  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<VideoPreview | null>(null);
  const [title, setTitle] = React.useState('');
  const [contentType, setContentType] = React.useState<'PODCAST' | 'SOLO'>(
    'PODCAST',
  );
  const [spokenLang, setSpokenLang] = React.useState<'ar' | 'en'>('ar');
  const [autoClips, setAutoClips] = React.useState(true);
  const [dragging, setDragging] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [state, setState] = React.useState<UploadState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = React.useState<PendingUpload | null>(
    null,
  );
  const [transferStatus, setTransferStatus] = React.useState('');
  const [remaining, setRemaining] = React.useState<string | null>(null);
  const [constraints, setConstraints] = React.useState<UploadConstraints | null>(
    null,
  );

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  const loadConstraints = React.useCallback(async () => {
    setError(null);
    try {
      setConstraints(await api.getVideoUploadConstraints());
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, 'Upload settings could not be loaded.'),
      );
    }
  }, []);

  React.useEffect(() => {
    if (status !== 'authenticated') return;
    const timer = window.setTimeout(() => {
      void loadConstraints();
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
      setError(
        language === 'ar'
          ? 'إعدادات الرفع قيد التحميل. حاول مجدداً بعد لحظات.'
          : 'Upload settings are still loading. Try again in a moment.',
      );
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

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) {
      resetFile();
      return;
    }
    void processFile(selected);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
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
    startedAt.current = getTimestamp();
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
          language: spokenLang,
          autoClips,
          contentType,
          filename: file.name,
          contentTypeHeader: file.type || 'video/mp4',
          sizeBytes: file.size,
        });
        activeUpload = {
          fileFingerprint: getFileFingerprint(file),
          nextByte: 0,
          title: title.trim(),
          uploadId: created.upload.uploadId ?? crypto.randomUUID(),
          videoId: created.video.id,
        };
        upload = created.upload;
        savePendingUpload(activeUpload);
        setPendingUpload(activeUpload);
      }

      if (!upload || !activeUpload) {
        throw new Error('Upload could not be prepared.');
      }
      const uploadState = activeUpload;

      if (uploadState.nextByte >= file.size) {
        setState('confirming');
        await confirmUpload(
          uploadState.videoId,
          uploadState.cloudinaryPublicId
            ? { publicId: uploadState.cloudinaryPublicId }
            : { uploadId: uploadState.uploadId },
          controller.signal,
        );
        clearPendingUpload(file);
        setPendingUpload(null);
        setState('complete');
        router.push(`/videos/${uploadState.videoId}`);
        return;
      }

      setState('uploading');
      const uploadResult = await uploadVideoInChunks(file, upload, {
        videoId: uploadState.videoId,
        uploadId: uploadState.uploadId,
        startAt: uploadState.nextByte,
        onChunkComplete: (nextByte) => {
          const nextUpload = { ...uploadState, nextByte };
          savePendingUpload(nextUpload);
          setPendingUpload(nextUpload);
        },
        onProgress: (percent) => {
          setProgress(percent);
          setRemaining(
            estimateRemaining(getTimestamp() - startedAt.current, percent),
          );
        },
        onRetry: (attempt) =>
          setTransferStatus(
            language === 'ar'
              ? `إعادة الاتصال (المحاولة ${attempt} من 3)`
              : `Reconnecting (attempt ${attempt} of 3)`,
          ),
        signal: controller.signal,
      });

      const completedUpload = {
        ...uploadState,
        cloudinaryPublicId: uploadResult.public_id,
      };
      savePendingUpload(completedUpload);
      setPendingUpload(completedUpload);
      setState('confirming');
      await confirmUpload(
        completedUpload.videoId,
        {
          uploadId: uploadResult.uploadId,
          parts: uploadResult.parts,
          publicId: uploadResult.public_id,
        },
        controller.signal,
      );
      clearPendingUpload(file);
      setPendingUpload(null);
      setTransferStatus('');
      setRemaining(null);
      setState('complete');
      router.push(`/videos/${completedUpload.videoId}`);
    } catch (uploadError) {
      if (
        uploadError instanceof DOMException &&
        uploadError.name === 'AbortError'
      ) {
        setTransferStatus(
          language === 'ar'
            ? 'تم إيقاف الرفع مؤقتاً. يمكنك استئنافه لاحقاً.'
            : 'Upload paused. Choose this same file to resume later.',
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

  function pauseUpload() {
    abortController.current?.abort();
  }

  function cancelUpload() {
    abortController.current?.abort();
    if (file) {
      clearPendingUpload(file);
    }
    resetFile();
  }

  async function confirmUpload(
    videoId: string,
    completeInput: Parameters<typeof api.completeVideo>[1],
    signal: AbortSignal,
  ) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await api.completeVideo(videoId, completeInput);
        return;
      } catch (confirmError) {
        if (
          !(confirmError instanceof ApiError) ||
          confirmError.status !== 409 ||
          attempt >= 4
        ) {
          throw confirmError;
        }

        setTransferStatus(
          language === 'ar'
            ? 'جاري تأكيد الرفع ومعالجة الملف...'
            : 'Finalizing upload. Retrying confirmation...',
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      }
    }
  }

  if (status === 'loading') {
    return <PageLoading label={t('common.loading')} />;
  }

  if (status !== 'authenticated') {
    return null;
  }

  const busy =
    state === 'creating' || state === 'uploading' || state === 'confirming';
  const canResume = pendingUpload !== null;
  const resolution = formatResolution(preview?.height ?? null);
  const extension = file?.name.split('.').pop()?.toUpperCase() ?? '';

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <AppHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 sm:px-8 py-8 space-y-8">
        {/* Top navigation link */}
        <div className="flex items-center justify-between">
          <Link
            className="text-xs sm:text-sm font-medium text-accent hover:underline flex items-center gap-1.5"
            href="/"
          >
            <span aria-hidden="true">{language === 'ar' ? '→' : '←'}</span>
            <span>{t('upload.backToWorkspace')}</span>
          </Link>
        </div>

        {/* Page Header */}
        <div className="space-y-1.5">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">
            {t('upload.uploadPodcastVideo')}
          </h1>
          <p className="text-sm text-muted leading-relaxed">
            {language === 'ar'
              ? 'ارفع بودكاست أو فيديو طويل، وسيقوم الذكاء الاصطناعي بتوليد الترجمة واقتراح مقاطع ريلز عمودية 9:16.'
              : 'Upload your podcast or video episode to generate Arabic clips, word-level transcripts, and vertical reels.'}
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger flex items-center justify-between"
            role="alert"
          >
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-xs underline hover:opacity-80 ms-3 shrink-0"
            >
              {t('common.close')}
            </button>
          </div>
        )}

        {/* File Dropzone / Picker */}
        <input
          accept={constraints?.allowedFormats.map((f) => `.${f}`).join(',') ?? '.mp4,.mov,.webm,.mkv'}
          className="sr-only"
          disabled={busy}
          id="video-file-input"
          onChange={handleFileChange}
          ref={fileInput}
          type="file"
        />

        {!file ? (
          <label
            className={`flex flex-col items-center justify-center p-8 sm:p-12 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-150 select-none ${
              dragging
                ? 'border-accent bg-accent-soft/30 scale-[1.01]'
                : 'border-border hover:border-border-strong bg-surface/50 hover:bg-surface'
            } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
            htmlFor="video-file-input"
            onDragLeave={() => setDragging(false)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDrop={handleDrop}
          >
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-2 border border-border text-muted mb-4 shadow-sm">
              <UploadCloudIcon />
            </div>

            <p className="text-base font-semibold text-text text-center">
              {t('upload.dropzone')}
            </p>
            <p className="text-xs text-muted mt-2 text-center max-w-sm">
              {language === 'ar'
                ? `الصيغ المدعومة: MP4, MOV, WEBM, MKV (الحد الأقصى ${constraints ? Math.round(constraints.maxDurationSec / 60) : 180} دقيقة)`
                : `Supported formats: MP4, MOV, WEBM, MKV (Up to ${constraints ? Math.round(constraints.maxDurationSec / 60) : 180} mins)`}
            </p>

            <div className="mt-6">
              <span className="inline-flex items-center justify-center font-medium rounded-lg px-4 py-2 text-sm bg-surface-2 border border-border text-text hover:bg-surface hover:border-border-strong transition-colors">
                {language === 'ar' ? 'اختر ملفاً من جهازك' : 'Choose video file'}
              </span>
            </div>
          </label>
        ) : (
          /* Selected File Information Card */
          <div className="rounded-xl border border-border bg-surface p-4 sm:p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-surface-2 border border-border text-accent shrink-0">
                <VideoFileIcon />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-text truncate">
                  {file.name}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{formatFileSize(file.size)}</span>
                  {extension && (
                    <Badge size="sm" variant="default">
                      {extension}
                    </Badge>
                  )}
                  {preview?.durationSec && (
                    <span>• {formatClock(preview.durationSec)}</span>
                  )}
                  {resolution && <span>• {resolution}</span>}
                </div>
              </div>
            </div>

            {!busy && (
              <Button onClick={resetFile} size="sm" variant="ghost">
                {language === 'ar' ? 'تغيير الملف' : 'Change'}
              </Button>
            )}
          </div>
        )}

        {/* Form Options (when file selected) */}
        {file && (
          <div className="space-y-6 pt-2">
            {/* Title field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text" htmlFor="video-title">
                {t('upload.videoTitle')}
              </label>
              <Input
                disabled={busy}
                id="video-title"
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('upload.videoTitle')}
                value={title}
              />
              <p className="text-[11px] text-muted">{t('upload.prefilledNote')}</p>
            </div>

            {/* Content Type Selection: 2 Cards (Podcast vs Solo) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-text">
                {t('upload.contentType')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Podcast Card */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setContentType('PODCAST')}
                  className={`text-start p-4 rounded-xl border transition-all duration-150 select-none ${
                    contentType === 'PODCAST'
                      ? 'border-accent bg-accent-soft/30 shadow-xs'
                      : 'border-border bg-surface hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl">🎙</span>
                    {contentType === 'PODCAST' && (
                      <span className="w-2 h-2 rounded-full bg-accent" />
                    )}
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-text">
                    {t('upload.contentTypePodcast')}
                  </h3>
                  <p className="mt-1 text-xs text-muted leading-relaxed">
                    {t('upload.contentTypePodcastDesc')}
                  </p>
                </button>

                {/* Solo Card */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setContentType('SOLO')}
                  className={`text-start p-4 rounded-xl border transition-all duration-150 select-none ${
                    contentType === 'SOLO'
                      ? 'border-accent bg-accent-soft/30 shadow-xs'
                      : 'border-border bg-surface hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl">👤</span>
                    {contentType === 'SOLO' && (
                      <span className="w-2 h-2 rounded-full bg-accent" />
                    )}
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-text">
                    {t('upload.contentTypeSolo')}
                  </h3>
                  <p className="mt-1 text-xs text-muted leading-relaxed">
                    {t('upload.contentTypeSoloDesc')}
                  </p>
                </button>
              </div>
            </div>

            {/* Language & Dialect Select */}
            <div className="space-y-1.5 max-w-xs">
              <label className="text-xs font-semibold text-text" htmlFor="language-select">
                {t('upload.spokenLanguage')}
              </label>
              <Select
                disabled={busy}
                id="language-select"
                onChange={(e) => setSpokenLang(e.target.value as 'ar' | 'en')}
                value={spokenLang}
              >
                <option value="ar">{language === 'ar' ? 'العربية (كل اللهجات)' : 'Arabic (All Dialects)'}</option>
                <option value="en">{language === 'ar' ? 'الإنجليزية' : 'English'}</option>
              </Select>
            </div>

            {/* Auto-clips Switch */}
            <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-border bg-surface">
              <div className="space-y-0.5">
                <label className="text-sm font-semibold text-text cursor-pointer" htmlFor="auto-clips-switch">
                  {t('upload.autoClipsLabel')}
                </label>
                <p className="text-xs text-muted leading-relaxed">
                  {t('upload.autoClipsDesc')}
                </p>
              </div>
              <Switch
                checked={autoClips}
                disabled={busy}
                id="auto-clips-switch"
                onCheckedChange={setAutoClips}
              />
            </div>

            {/* Upload Progress & Transfer Status Display */}
            {busy && (
              <div className="space-y-3 p-4 rounded-xl border border-border bg-surface-2">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="font-medium text-text">
                    {state === 'confirming'
                      ? t('upload.confirmingUpload')
                      : `${t('upload.uploading')} (${progress}%)`}
                  </span>
                  {remaining && <span>{remaining}</span>}
                </div>

                <Progress
                  className="h-2.5"
                  value={progress}
                  variant={state === 'confirming' ? 'info' : 'accent'}
                />

                {transferStatus && (
                  <p className="text-xs text-muted text-center pt-1 animate-pulse">
                    {transferStatus}
                  </p>
                )}
              </div>
            )}

            {/* Main Action Buttons */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              {!busy ? (
                <Button
                  className="w-full sm:w-auto min-w-44"
                  disabled={!title.trim()}
                  onClick={() => void startUpload()}
                  size="lg"
                  variant="primary"
                >
                  <span className="me-2 text-base leading-none">↑</span>
                  {canResume ? t('upload.resumeUpload') : t('upload.startUpload')}
                </Button>
              ) : (
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <Button
                    onClick={pauseUpload}
                    size="md"
                    variant="secondary"
                  >
                    {t('upload.pauseUpload')}
                  </Button>
                  <Button
                    onClick={cancelUpload}
                    size="md"
                    variant="danger"
                  >
                    {t('upload.cancelUpload')}
                  </Button>
                </div>
              )}

              {canResume && !busy && (
                <Button onClick={cancelUpload} size="md" variant="ghost">
                  {language === 'ar' ? 'البدء من جديد' : 'Start Fresh'}
                </Button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function UploadCloudIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-8 text-muted"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M12 12v9" />
      <path d="m16 16-4-4-4 4" />
    </svg>
  );
}

function VideoFileIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-6 w-6 text-accent"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect height="12" rx="2" width="14" x="2" y="6" />
    </svg>
  );
}
