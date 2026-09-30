import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { readStoredBurnIn } from '../subtitles/subtitle-overlay';

const RENDERING_STATUSES = [404, 423];

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
    const outputUrl = await this.storage.startClipReelRender(
      publicId,
      render.startSec,
      render.endSec,
      burnIn ?? undefined,
    );
    await onProgress(30);
    await this.waitUntilAvailable(outputUrl);
    await this.prisma.clipRender.update({
      where: { id: render.id },
      data: { outputUrl },
    });
    return outputUrl;
  }

  private async waitUntilAvailable(url: string): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;

    for (;;) {
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

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }
}
