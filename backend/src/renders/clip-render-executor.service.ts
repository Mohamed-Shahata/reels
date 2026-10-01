import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { readStoredBurnIn } from '../subtitles/subtitle-overlay';

const RENDERING_STATUSES = [404, 423];

/** Progress reported once Cloudinary accepted the job. */
const WAIT_START = 30;
/** Never claim more than this until the file is actually available. */
const WAIT_CEILING = 95;

/**
 * Cloudinary renders asynchronously and exposes no percentage, so while
 * waiting we report an estimate that eases from WAIT_START towards
 * WAIT_CEILING. The time constant grows with the clip length.
 */
export function estimateWaitProgress(
  elapsedMs: number,
  clipSeconds: number,
): number {
  const tauMs = (15 + Math.max(clipSeconds, 0) * 0.6) * 1000;
  const fraction = 1 - Math.exp(-elapsedMs / tauMs);
  return Math.min(
    WAIT_CEILING,
    Math.round(WAIT_START + (WAIT_CEILING - WAIT_START) * fraction),
  );
}

/** Thrown when the user stops a render that is being processed. */
export class RenderStoppedError extends Error {
  constructor() {
    super('The render was stopped');
    this.name = 'RenderStoppedError';
  }
}

@Injectable()
export class ClipRenderExecutorService {
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.pollIntervalMs = config.get('RENDER_POLL_INTERVAL_MS', {
      infer: true,
    });
    this.timeoutMs = config.get('RENDER_TIMEOUT_MS', { infer: true });
  }

  async execute(
    clipRenderId: string,
    onProgress: (progress: number) => Promise<void>,
    shouldStop: () => Promise<boolean> = () => Promise.resolve(false),
  ): Promise<string> {
    const render = await this.prisma.clipRender.findUnique({
      where: { id: clipRenderId },
      select: {
        id: true,
        startSec: true,
        endSec: true,
        subtitleStyle: true,
        subtitleCues: true,
        clip: { select: { video: { select: { cloudinaryId: true } } } },
      },
    });

    const publicId = render?.clip.video.cloudinaryId;
    if (!render || !publicId) {
      throw new Error('Render source video is unavailable');
    }

    const burnIn = readStoredBurnIn(render.subtitleStyle, render.subtitleCues);

    await onProgress(10);
    await this.throwIfStopped(shouldStop);
    const outputUrl = await this.storage.startClipReelRender(
      publicId,
      render.startSec,
      render.endSec,
      burnIn ?? undefined,
    );
    await onProgress(30);
    await this.waitUntilAvailable(
      outputUrl,
      render.endSec - render.startSec,
      onProgress,
      shouldStop,
    );
    await this.prisma.clipRender.update({
      where: { id: render.id },
      data: { outputUrl },
    });
    return outputUrl;
  }

  private async throwIfStopped(
    shouldStop: () => Promise<boolean>,
  ): Promise<void> {
    if (await shouldStop()) throw new RenderStoppedError();
  }

  private async waitUntilAvailable(
    url: string,
    clipSeconds: number,
    onProgress: (progress: number) => Promise<void>,
    shouldStop: () => Promise<boolean>,
  ): Promise<void> {
    const startedAt = Date.now();
    const deadline = startedAt + this.timeoutMs;
    let reported = WAIT_START;

    for (;;) {
      await this.throwIfStopped(shouldStop);
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) return;

      if (!RENDERING_STATUSES.includes(response.status)) {
        throw new Error(
          `Cloudinary could not render the clip (status ${response.status})`,
        );
      }

      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the reel to render');
      }

      const estimate = estimateWaitProgress(
        Date.now() - startedAt,
        clipSeconds,
      );
      if (estimate > reported) {
        reported = estimate;
        await onProgress(estimate);
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }
}
