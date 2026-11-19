'use client';

import { useRef, useEffect, useState, useMemo } from 'react';
import type { ReframePlan } from '@/lib/api';

interface ClipPreviewPlayerProps {
  videoPlaybackUrl?: string | null;
  startSec: number;
  endSec: number;
  reframePlan?: ReframePlan | null;
  layout: 'AUTO' | 'STACKED';
  subtitlesEnabled: boolean;
  subtitleStyle: string;
  activeCaption?: string | null;
  onTimeChange?: (timeSec: number) => void;
}

export function ClipPreviewPlayer({
  videoPlaybackUrl,
  startSec,
  endSec,
  reframePlan,
  layout,
  subtitlesEnabled,
  subtitleStyle,
  activeCaption,
  onTimeChange,
}: ClipPreviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bottomVideoRef = useRef<HTMLVideoElement | null>(null);

  const [currentTime, setCurrentTime] = useState(startSec);
  const [isPlaying, setIsPlaying] = useState(false);

  // Calculate current horizontal focus point X in [0, 1] from reframePlan
  const speakerX = useMemo(() => {
    if (!reframePlan || layout === 'STACKED') return 0.5;

    const turns = (reframePlan as { speakerTurns?: Array<{ startSec?: number; endSec?: number; speaker?: string | number }> })
      .speakerTurns;

    if (Array.isArray(turns) && turns.length > 0) {
      const activeTurn = turns.find((t) => {
        const s = t.startSec ?? 0;
        const e = t.endSec ?? 999999;
        return currentTime >= s && currentTime <= e;
      });
      if (activeTurn) {
        // Alternating speaker horizontal bias: speaker 1 left (0.28), speaker 2 right (0.72)
        const spId = String(activeTurn.speaker);
        return spId.includes('1') || spId.toLowerCase().includes('a') ? 0.28 : 0.72;
      }
    }

    const faces = (reframePlan as { faces?: Array<{ timeSec?: number; x?: number; box?: { x: number; w: number } }> }).faces;
    if (Array.isArray(faces) && faces.length > 0) {
      const match = faces.find((f) => Math.abs((f.timeSec ?? 0) - currentTime) < 1.0);
      if (match?.box && typeof match.box.x === 'number') {
        return Math.max(0.15, Math.min(0.85, match.box.x + match.box.w / 2));
      }
      if (match && typeof match.x === 'number') {
        return Math.max(0.15, Math.min(0.85, match.x));
      }
    }

    return 0.5;
  }, [reframePlan, layout, currentTime]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const time = video.currentTime;
    setCurrentTime(time);
    onTimeChange?.(time);

    // Loop clip range
    if (time >= endSec) {
      video.currentTime = startSec;
      if (bottomVideoRef.current) bottomVideoRef.current.currentTime = startSec;
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      if (video.currentTime < startSec || video.currentTime >= endSec) {
        video.currentTime = startSec;
      }
      void video.play();
      if (bottomVideoRef.current) void bottomVideoRef.current.play();
      setIsPlaying(true);
    } else {
      video.pause();
      if (bottomVideoRef.current) bottomVideoRef.current.pause();
      setIsPlaying(false);
    }
  };

  // Seek video when startSec changes
  useEffect(() => {
    const video = videoRef.current;
    if (video && (video.currentTime < startSec || video.currentTime > endSec)) {
      video.currentTime = startSec;
      if (bottomVideoRef.current) bottomVideoRef.current.currentTime = startSec;
      setCurrentTime(startSec);
    }
  }, [startSec, endSec, videoRef]);

  // CSS transform offsets:
  // 16:9 in 9:16 container is 316% width.
  // Center is -50%. Deviation from 0.5 shifts horizontally.
  const shiftPercent = Math.max(-100, Math.min(100, (0.5 - speakerX) * 100));

  return (
    <div className="flex justify-center select-none">
      <div
        onClick={togglePlay}
        className="group relative aspect-[9/16] w-48 sm:w-56 overflow-hidden rounded-2xl border border-border bg-black shadow-lg cursor-pointer"
        role="button"
        tabIndex={0}
        aria-label="Toggle preview playback"
      >
        {videoPlaybackUrl ? (
          layout === 'STACKED' ? (
            /* Stacked Layout: Split 50% Top and 50% Bottom */
            <div className="w-full h-full flex flex-col">
              <div className="relative w-full h-1/2 overflow-hidden border-b border-white/10">
                <video
                  ref={videoRef}
                  src={videoPlaybackUrl}
                  onTimeUpdate={handleTimeUpdate}
                  className="absolute top-0 h-full w-[316%] max-w-none left-1/2"
                  style={{ transform: 'translateX(-72%)' }}
                  playsInline
                  muted
                />
              </div>
              <div className="relative w-full h-1/2 overflow-hidden">
                <video
                  ref={bottomVideoRef}
                  src={videoPlaybackUrl}
                  className="absolute top-0 h-full w-[316%] max-w-none left-1/2"
                  style={{ transform: 'translateX(-28%)' }}
                  playsInline
                  muted
                />
              </div>
            </div>
          ) : (
            /* Auto/Single Speaker Tracking via CSS crop transform */
            <div className="relative w-full h-full overflow-hidden">
              <video
                ref={videoRef}
                src={videoPlaybackUrl}
                onTimeUpdate={handleTimeUpdate}
                className="absolute top-0 h-full w-[316%] max-w-none left-1/2 transition-transform duration-500 ease-out"
                style={{ transform: `translateX(calc(-50% + ${shiftPercent}%))` }}
                playsInline
              />
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4 text-center">
            <span className="text-xs">No video preview</span>
          </div>
        )}

        {/* Play/Pause Overlay Icon when paused */}
        {!isPlaying && videoPlaybackUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-colors">
            <div className="w-12 h-12 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center shadow-lg">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          </div>
        )}

        {/* Live Subtitle Overlay */}
        {subtitlesEnabled && activeCaption && (
          <div className="absolute bottom-6 inset-x-3 pointer-events-none flex justify-center">
            {subtitleStyle === 'modern' ? (
              <span className="bg-background/90 text-primary px-3 py-1.5 rounded-lg border border-border text-xs font-bold shadow-md text-center leading-snug">
                {activeCaption}
              </span>
            ) : subtitleStyle === 'classic' ? (
              <span className="text-foreground text-xs font-semibold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] text-center leading-snug">
                {activeCaption}
              </span>
            ) : (
              <span className="text-primary text-sm font-extrabold uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] text-center tracking-wide leading-snug">
                {activeCaption}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
