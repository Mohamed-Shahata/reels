'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  api,
  type VideoDetails,
  type Clip,
  type Transcript,
  type ClipRender,
  type ReframePlan,
  type PipelineStage,
} from '@/lib/api';
import { useJobPolling } from './use-job-polling';

const ACTIVE_JOB_STATUSES = new Set(['PENDING', 'QUEUED', 'RUNNING', 'RETRYING']);

export function useVideo(videoId: string) {
  const [video, setVideo] = useState<VideoDetails | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [renders, setRenders] = useState<ClipRender[]>([]);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [reframePlan, setReframePlan] = useState<ReframePlan | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRetryingStage, setIsRetryingStage] = useState<string | null>(null);

  const refreshVideo = useCallback(async (): Promise<boolean> => {
    if (!videoId) return false;
    let hasActiveWork = false;

    try {
      let currentVideo: VideoDetails | null = null;
      try {
        currentVideo = await api.getVideo(videoId);
      } catch {
        const all = await api.getVideos();
        const match = all.find((v) => v.id === videoId);
        if (match) {
          currentVideo = {
            ...match,
            pipeline: [],
            mediaAssets: [],
          };
        }
      }

      if (currentVideo) {
        setVideo(currentVideo);

        const hasActivePipeline = currentVideo.pipeline?.some((p) =>
          ACTIVE_JOB_STATUSES.has(p.status),
        );
        if (hasActivePipeline || currentVideo.status === 'UPLOADING') {
          hasActiveWork = true;
        }
      }

      // Concurrently fetch clips, transcript, renders, playback URL
      const [fetchedClips, fetchedRenders] = await Promise.all([
        api.getClips(videoId).catch(() => []),
        api.getVideoRenders(videoId).catch(() => []),
      ]);

      setClips(fetchedClips);
      setRenders(fetchedRenders);

      const hasActiveRenders = fetchedRenders.some((r) =>
        ACTIVE_JOB_STATUSES.has(r.status),
      );
      if (hasActiveRenders) {
        hasActiveWork = true;
      }

      return hasActiveWork;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch video');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [videoId]);

  // Initial load of transcript, playback url, reframe plan
  useEffect(() => {
    if (!videoId) return;

    let mounted = true;
    Promise.allSettled([
      api.getVideoPlaybackUrl(videoId),
      api.getVideoTranscript(videoId),
      api.getVideoReframePlan(videoId),
    ]).then(([pbResult, trResult, rfResult]) => {
      if (!mounted) return;
      if (pbResult.status === 'fulfilled') setPlaybackUrl(pbResult.value.url);
      if (trResult.status === 'fulfilled') setTranscript(trResult.value);
      if (rfResult.status === 'fulfilled') setReframePlan(rfResult.value);
    });

    return () => {
      mounted = false;
    };
  }, [videoId]);

  const { pollNow } = useJobPolling({
    enabled: Boolean(videoId),
    onPoll: refreshVideo,
  });

  const retryStage = useCallback(
    async (stage: PipelineStage) => {
      if (!stage.jobId) return;
      setIsRetryingStage(stage.stage);
      try {
        await api.retryJob(stage.jobId);
        await pollNow();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Retry failed');
      } finally {
        setIsRetryingStage(null);
      }
    },
    [pollNow],
  );

  const deleteClip = useCallback(
    async (clipId: string) => {
      await api.deleteClip(clipId);
      setClips((prev) => prev.filter((c) => c.id !== clipId));
    },
    [],
  );

  const renameClip = useCallback(
    async (clipId: string, newTitle: string) => {
      const updated = await api.updateClip(clipId, { title: newTitle });
      setClips((prev) => prev.map((c) => (c.id === clipId ? updated : c)));
    },
    [],
  );

  const [isGeneratingClips, setIsGeneratingClips] = useState(false);

  const generateAiClips = useCallback(async () => {
    if (!videoId) return;
    setIsGeneratingClips(true);
    try {
      const generated = await api.createAiClips(videoId);
      setClips(generated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate clips');
    } finally {
      setIsGeneratingClips(false);
    }
  }, [videoId]);

  return {
    video,
    clips,
    transcript,
    renders,
    playbackUrl,
    reframePlan,
    isLoading,
    error,
    isRetryingStage,
    isGeneratingClips,
    generateAiClips,
    refreshVideo,
    pollNow,
    retryStage,
    deleteClip,
    renameClip,
    setClips,
    setVideo,
  };
}
