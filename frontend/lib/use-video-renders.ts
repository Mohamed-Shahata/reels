'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  getApiErrorMessage,
  type ClipRender,
  type RenderRequestOptions,
} from './api';
import {
  isRenderActive,
  mergeRendersByClip,
  withoutSubtitledRenders,
  type RendersByClipId,
} from './clip-render';

export interface ClipRenderRequest {
  clipId: string;
  options: RenderRequestOptions;
}

const POLL_INTERVAL_MS = 3000;

export function useVideoRenders(
  videoId: string | undefined,
  enabled: boolean,
  onError: (message: string | null) => void,
) {
  const [rendersByClipId, setRendersByClipId] = useState<RendersByClipId>({});
  const [busyClipIds, setBusyClipIds] = useState<string[]>([]);
  const [renderingAll, setRenderingAll] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);
  const onErrorRef = useRef(onError);
  // Set by stopAll so renderEach does not keep queueing the remaining clips.
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const mergeRenders = useCallback((incoming: ClipRender[]) => {
    setRendersByClipId((current) => mergeRendersByClip(current, incoming));
  }, []);

  useEffect(() => {
    if (!enabled || !videoId) return;

    let cancelled = false;
    api
      .getVideoRenders(videoId)
      .then((renders) => {
        if (!cancelled) mergeRenders(renders);
      })
      .catch((requestError) => {
        if (!cancelled) {
          onErrorRef.current(
            getApiErrorMessage(
              requestError,
              'Render status could not be loaded.',
            ),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, mergeRenders, videoId]);

  const hasActiveRender = Object.values(rendersByClipId).some((renders) =>
    renders.some(isRenderActive),
  );

  useEffect(() => {
    if (!enabled || !videoId || !hasActiveRender) return;

    const interval = setInterval(() => {
      api
        .getVideoRenders(videoId)
        .then(mergeRenders)
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, hasActiveRender, mergeRenders, videoId]);

  const runForClip = useCallback(
    async (
      clipId: string,
      action: () => Promise<ClipRender>,
      fallbackMessage: string,
    ) => {
      setBusyClipIds((current) => [...current, clipId]);
      onErrorRef.current(null);
      try {
        mergeRenders([await action()]);
      } catch (requestError) {
        onErrorRef.current(getApiErrorMessage(requestError, fallbackMessage));
      } finally {
        setBusyClipIds((current) => current.filter((id) => id !== clipId));
      }
    },
    [mergeRenders],
  );

  const renderClip = useCallback(
    (clipId: string, options: RenderRequestOptions) =>
      runForClip(
        clipId,
        () => api.renderClip(clipId, options),
        'Render could not be started.',
      ),
    [runForClip],
  );

  const regenerateClip = useCallback(
    (clipId: string, options: RenderRequestOptions) =>
      runForClip(
        clipId,
        async () => {
          // The old subtitled copies go first, so the new render replaces them.
          setRendersByClipId((current) =>
            withoutSubtitledRenders(current, clipId),
          );
          return api.renderClip(clipId, { ...options, regenerate: true });
        },
        'Subtitles could not be regenerated.',
      ),
    [runForClip],
  );

  /**
   * Called when the subtitle style or text changes: the renders with burned-in
   * subtitles no longer match, so they are removed (here and on the server)
   * and new ones can be made. Pass a clip id to limit it to that clip.
   */
  const discardSubtitled = useCallback(
    (clipId?: string) => {
      if (!videoId) return;
      setRendersByClipId((current) => withoutSubtitledRenders(current, clipId));
      const request = clipId
        ? api.deleteClipSubtitledRenders(clipId)
        : api.deleteSubtitledRenders(videoId);
      request.catch((requestError) => {
        onErrorRef.current(
          getApiErrorMessage(
            requestError,
            'Old subtitled videos could not be removed.',
          ),
        );
      });
    },
    [videoId],
  );

  const retryRender = useCallback(
    (clipId: string, renderId: string) =>
      runForClip(
        clipId,
        () => api.retryRender(renderId),
        'Render could not be retried.',
      ),
    [runForClip],
  );

  /** Stops the render of one clip. It stays resumable with retryRender. */
  const stopClip = useCallback(
    (clipId: string, renderId: string) =>
      runForClip(
        clipId,
        () => api.stopRender(renderId),
        'Render could not be stopped.',
      ),
    [runForClip],
  );

  /** Stops every render in progress for this video. */
  const stopAll = useCallback(async () => {
    if (!videoId) return;
    setStoppingAll(true);
    stopRequestedRef.current = true;
    onErrorRef.current(null);
    try {
      mergeRenders(await api.stopVideoRenders(videoId));
    } catch (requestError) {
      onErrorRef.current(
        getApiErrorMessage(requestError, 'Renders could not be stopped.'),
      );
    } finally {
      setStoppingAll(false);
    }
  }, [mergeRenders, videoId]);

  const renderAll = useCallback(
    async (options: RenderRequestOptions) => {
      if (!videoId) return;
      setRenderingAll(true);
      onErrorRef.current(null);
      try {
        mergeRenders(await api.renderAllClips(videoId, options));
      } catch (requestError) {
        onErrorRef.current(
          getApiErrorMessage(requestError, 'Renders could not be started.'),
        );
      } finally {
        setRenderingAll(false);
      }
    },
    [mergeRenders, videoId],
  );

  const renderEach = useCallback(
    async (requests: ClipRenderRequest[]) => {
      setRenderingAll(true);
      stopRequestedRef.current = false;
      onErrorRef.current(null);
      try {
        for (const request of requests) {
          if (stopRequestedRef.current) break;
          mergeRenders([await api.renderClip(request.clipId, request.options)]);
        }
      } catch (requestError) {
        onErrorRef.current(
          getApiErrorMessage(requestError, 'Renders could not be started.'),
        );
      } finally {
        setRenderingAll(false);
      }
    },
    [mergeRenders],
  );

  return {
    rendersByClipId,
    busyClipIds,
    renderingAll,
    stoppingAll,
    renderClip,
    regenerateClip,
    discardSubtitled,
    retryRender,
    stopClip,
    stopAll,
    renderAll,
    renderEach,
    mergeRenders,
  };
}
