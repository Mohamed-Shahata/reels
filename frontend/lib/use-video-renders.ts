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
  const onErrorRef = useRef(onError);

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

  const retryRender = useCallback(
    (clipId: string, renderId: string) =>
      runForClip(
        clipId,
        () => api.retryRender(renderId),
        'Render could not be retried.',
      ),
    [runForClip],
  );

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
      onErrorRef.current(null);
      try {
        for (const request of requests) {
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
    renderClip,
    retryRender,
    renderAll,
    renderEach,
  };
}
