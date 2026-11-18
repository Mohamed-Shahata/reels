import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { ProcessingJob } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReelsQueueName } from '../../rabbit/rabbit.constants';
import { RabbitService } from '../../rabbit/rabbit.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { MediaAssetService } from '../../storage/media-asset.service';
import { ProcessingJobsService } from '../../processing/processing-jobs.service';
import type { Env } from '../../config/env.schema';
import {
  BaseJobConsumer,
  type JobExecutionContext,
} from '../base/base-job-consumer';
import { FatalJobError, JOB_ERROR_CODES } from '../errors/job.error';

const execFileAsync = promisify(execFile);

export interface IngestPayload {
  videoId?: string;
  storageKey?: string;
}

interface FFprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FFprobeFormat {
  duration?: string;
  size?: string;
  bit_rate?: string;
  format_name?: string;
}

interface FFprobeOutput {
  streams?: FFprobeStream[];
  format?: FFprobeFormat;
}

@Injectable()
export class IngestConsumer
  extends BaseJobConsumer<IngestPayload>
  implements OnModuleInit
{
  protected readonly queue: ReelsQueueName = 'ingest';
  private readonly maxDurationSec: number;

  constructor(
    prisma: PrismaService,
    rabbit: RabbitService,
    private readonly s3: S3StorageService,
    private readonly mediaAssets: MediaAssetService,
    private readonly jobsService: ProcessingJobsService,
    config: ConfigService<Env, true>,
  ) {
    super(prisma, rabbit);
    this.maxDurationSec = config.get('VIDEO_MAX_DURATION_SEC', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    await this.startConsuming(2);
    this.logger.log(
      'IngestConsumer initialized and listening on queue "ingest"',
    );
  }

  protected async handle(
    job: ProcessingJob,
    payload: IngestPayload,
    ctx: JobExecutionContext,
  ): Promise<void> {
    const videoId = payload.videoId ?? job.videoId;
    if (!videoId) {
      throw new FatalJobError('Ingest job missing videoId', {
        code: 'MISSING_VIDEO_ID',
      });
    }

    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
    });

    if (!video) {
      throw new FatalJobError(`Video ${videoId} was not found`, {
        code: 'VIDEO_NOT_FOUND',
      });
    }

    // 1. Update Video status to PROCESSING
    await this.prisma.video.update({
      where: { id: video.id },
      data: { status: 'PROCESSING' },
    });

    await ctx.logEvent(
      'INFO',
      `Starting ingest processing for video ${video.id}`,
    );
    await ctx.updateProgress(5);

    // 2. Locate source MediaAsset
    const sourceAsset = await this.prisma.mediaAsset.findFirst({
      where: { videoId: video.id, kind: 'SOURCE' },
    });

    const storageKey = payload.storageKey ?? sourceAsset?.storageKey;
    if (!storageKey) {
      throw new FatalJobError(
        `No source storage key found for video ${video.id}`,
        {
          code: 'SOURCE_NOT_FOUND',
        },
      );
    }

    // 3. Download source file to local workDir
    const ext = extname(storageKey) || '.mp4';
    const localSourcePath = join(ctx.workDir, `source${ext}`);

    try {
      const { stream } = await this.mediaAssets.getAssetStream(storageKey);
      await pipeline(stream, createWriteStream(localSourcePath));
    } catch (err) {
      throw new FatalJobError(
        `Failed to download source video from storage: ${(err as Error).message}`,
        { code: JOB_ERROR_CODES.STORAGE_ERROR, cause: err },
      );
    }

    await ctx.heartbeat();
    await ctx.logEvent('INFO', 'Downloaded source video successfully');
    await ctx.updateProgress(20);

    // 4. Probe with ffprobe
    const probeData = await this.probeMedia(localSourcePath);
    const audioStream = probeData.streams?.find(
      (s) => s.codec_type === 'audio',
    );
    if (!audioStream) {
      throw new FatalJobError('Uploaded video has no audio track', {
        code: JOB_ERROR_CODES.NO_AUDIO_TRACK,
        userMessage: 'The uploaded video does not contain an audio track.',
      });
    }

    const rawDuration =
      probeData.format?.duration ??
      probeData.streams?.find((s) => s.codec_type === 'video')?.duration;
    const durationSec = rawDuration ? parseFloat(rawDuration) : 0;

    if (durationSec > this.maxDurationSec) {
      throw new FatalJobError(
        `Video duration (${durationSec}s) exceeds maximum allowed duration (${this.maxDurationSec}s)`,
        {
          code: JOB_ERROR_CODES.DURATION_EXCEEDED,
          userMessage:
            'The uploaded video exceeds the maximum allowed duration.',
        },
      );
    }

    // Update video duration in DB
    await this.prisma.video.update({
      where: { id: video.id },
      data: { durationSec },
    });

    await ctx.heartbeat();
    await ctx.logEvent(
      'INFO',
      `Probed video: duration ${durationSec.toFixed(2)}s, audio present`,
    );
    await ctx.updateProgress(35);

    // 5. Extract mono 16kHz audio for transcription (Whisper/Groq)
    const localAudioPath = join(ctx.workDir, 'audio.mp3');
    await this.runFfmpeg([
      '-y',
      '-i',
      localSourcePath,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '64k',
      localAudioPath,
    ]);

    const audioBuffer = await readFile(localAudioPath);
    await this.mediaAssets.putAsset({
      userId: video.userId,
      videoId: video.id,
      kind: 'AUDIO',
      body: audioBuffer,
      contentType: 'audio/mpeg',
    });

    await ctx.heartbeat();
    await ctx.logEvent('INFO', 'Extracted and stored 16kHz mono audio');
    await ctx.updateProgress(55);

    // 6. Extract poster frame
    const localPosterPath = join(ctx.workDir, 'poster.jpg');
    const posterSec = Math.min(1.0, durationSec > 0 ? durationSec / 2 : 0);
    await this.runFfmpeg([
      '-y',
      '-ss',
      posterSec.toString(),
      '-i',
      localSourcePath,
      '-vframes',
      '1',
      '-q:v',
      '2',
      localPosterPath,
    ]);

    const posterBuffer = await readFile(localPosterPath);
    await this.mediaAssets.putAsset({
      userId: video.userId,
      videoId: video.id,
      kind: 'POSTER',
      body: posterBuffer,
      contentType: 'image/jpeg',
    });

    await ctx.heartbeat();
    await ctx.logEvent('INFO', 'Generated and stored poster thumbnail');
    await ctx.updateProgress(75);

    // 7. Generate 720p proxy H.264
    const localProxyPath = join(ctx.workDir, 'proxy-720p.mp4');
    await this.runFfmpeg([
      '-y',
      '-i',
      localSourcePath,
      '-vf',
      'scale=-2:720',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '26',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      localProxyPath,
    ]);

    await this.mediaAssets.putAsset({
      userId: video.userId,
      videoId: video.id,
      kind: 'PROXY',
      body: createReadStream(localProxyPath),
      contentType: 'video/mp4',
    });

    await ctx.heartbeat();
    await ctx.logEvent('INFO', 'Generated and stored 720p proxy video');
    await ctx.updateProgress(90);

    // 8. Enqueue TRANSCRIBE job via Transactional Outbox
    await this.prisma.$transaction(async (tx) => {
      await this.jobsService.enqueue(tx, {
        userId: video.userId,
        videoId: video.id,
        type: 'TRANSCRIBE',
        payload: {
          videoId: video.id,
          language: video.language ?? 'ar',
        },
      });
    });

    await ctx.updateProgress(100);
    await ctx.logEvent(
      'INFO',
      'Ingest pipeline stage completed, transcribe stage enqueued',
    );
  }

  private async probeMedia(filePath: string): Promise<FFprobeOutput> {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ]);
      return JSON.parse(stdout) as FFprobeOutput;
    } catch (err) {
      throw new FatalJobError(
        `Failed to probe video with ffprobe: ${(err as Error).message}`,
        { code: JOB_ERROR_CODES.CORRUPT_MEDIA, cause: err },
      );
    }
  }

  private async runFfmpeg(args: string[]): Promise<void> {
    try {
      await execFileAsync('ffmpeg', args);
    } catch (err) {
      throw new FatalJobError(
        `FFmpeg execution failed: ${(err as Error).message}`,
        { code: 'FFMPEG_FAILED', cause: err },
      );
    }
  }
}
