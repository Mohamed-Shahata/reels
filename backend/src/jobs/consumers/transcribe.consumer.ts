import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ProcessingJob } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReelsQueueName } from '../../rabbit/rabbit.constants';
import { RabbitService } from '../../rabbit/rabbit.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { MediaAssetService } from '../../storage/media-asset.service';
import { ProcessingJobsService } from '../../processing/processing-jobs.service';
import {
  TranscriptionService,
  type GroqSegment,
} from '../../transcription/transcription.service';
import type { Env } from '../../config/env.schema';
import {
  BaseJobConsumer,
  type JobExecutionContext,
} from '../base/base-job-consumer';
import {
  FatalJobError,
  RetryableJobError,
  JOB_ERROR_CODES,
} from '../errors/job.error';

export interface TranscribePayload {
  videoId?: string;
  language?: string;
}

@Injectable()
export class TranscribeConsumer
  extends BaseJobConsumer<TranscribePayload>
  implements OnModuleInit
{
  protected readonly queue: ReelsQueueName = 'transcribe';
  private readonly concurrency: number;

  constructor(
    prisma: PrismaService,
    rabbit: RabbitService,
    private readonly s3: S3StorageService,
    private readonly mediaAssets: MediaAssetService,
    private readonly jobsService: ProcessingJobsService,
    private readonly transcription: TranscriptionService,
    config: ConfigService<Env, true>,
  ) {
    super(prisma, rabbit);
    this.concurrency = config.get('TRANSCRIBE_CONCURRENCY', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    await this.startConsuming(2);
    this.logger.log(
      'TranscribeConsumer initialized and listening on queue "transcribe"',
    );
  }

  protected async handle(
    job: ProcessingJob,
    payload: TranscribePayload,
    ctx: JobExecutionContext,
  ): Promise<void> {
    const videoId = payload.videoId ?? job.videoId;
    if (!videoId) {
      throw new FatalJobError('Transcribe job missing videoId', {
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

    await ctx.logEvent(
      'INFO',
      `Starting transcribe stage for video ${video.id}`,
    );
    await ctx.updateProgress(5);

    // 1. Locate audio asset
    const audioAsset = await this.prisma.mediaAsset.findFirst({
      where: { videoId: video.id, kind: 'AUDIO' },
    });

    if (!audioAsset) {
      throw new FatalJobError(`Audio asset not found for video ${video.id}`, {
        code: 'AUDIO_ASSET_NOT_FOUND',
      });
    }

    // 2. Download audio file into workDir
    const localAudioPath = join(ctx.workDir, 'audio.mp3');
    try {
      const { stream } = await this.mediaAssets.getAssetStream(
        audioAsset.storageKey,
      );
      await pipeline(stream, createWriteStream(localAudioPath));
    } catch (err) {
      throw new RetryableJobError(
        `Failed to download audio from storage: ${(err as Error).message}`,
        { code: JOB_ERROR_CODES.STORAGE_ERROR, cause: err },
      );
    }

    await ctx.heartbeat();
    await ctx.logEvent('INFO', 'Downloaded audio asset, splitting into chunks');
    await ctx.updateProgress(10);

    // 3. Split audio into chunks with overlap in workDir/chunks
    const chunksDir = join(ctx.workDir, 'chunks');
    const chunks = await this.transcription.chunkAudio(
      localAudioPath,
      video.id,
      chunksDir,
    );

    if (chunks.length === 0) {
      throw new FatalJobError('No audio chunks generated', {
        code: JOB_ERROR_CODES.CORRUPT_MEDIA,
      });
    }

    // 4. Checkpoint check & transcription of missing chunks
    const totalChunks = chunks.length;
    const chunkSegments: GroqSegment[][] = Array.from({ length: totalChunks });
    const missingIndices: number[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const checkpointKey = `users/${video.userId}/videos/${video.id}/transcripts/chunk-${i}.json`;
      const cached = await this.loadChunkCheckpoint(checkpointKey);
      if (cached) {
        chunkSegments[i] = cached;
      } else {
        missingIndices.push(i);
      }
    }

    let completedCount = totalChunks - missingIndices.length;
    await ctx.logEvent(
      'INFO',
      `Found ${completedCount}/${totalChunks} checkpoints, transcribing ${missingIndices.length} chunks`,
    );

    // Process missing chunks in parallel with controlled concurrency
    if (missingIndices.length > 0) {
      const language = payload.language ?? video.language ?? 'ar';
      await this.processChunksWithConcurrency(
        missingIndices,
        chunks,
        language,
        video.userId,
        video.id,
        this.concurrency,
        async (index, segments) => {
          chunkSegments[index] = segments;
          completedCount++;
          const progress = 10 + Math.round((completedCount / totalChunks) * 80);
          await ctx.updateProgress(progress);
          await ctx.heartbeat();
        },
      );
    }

    await ctx.logEvent('INFO', 'All chunks transcribed, merging segments');
    await ctx.updateProgress(90);

    // 5. Merge segments & store in database
    const language = payload.language ?? video.language ?? 'ar';
    await this.transcription.mergeAndStore(
      video.id,
      chunks,
      chunkSegments,
      language,
    );

    // 6. Enqueue SEGMENT job via Transactional Outbox
    await this.prisma.$transaction(async (tx) => {
      await this.jobsService.enqueue(tx, {
        userId: video.userId,
        videoId: video.id,
        type: 'SEGMENT',
        payload: {
          videoId: video.id,
        },
      });
    });

    await ctx.updateProgress(100);
    await ctx.logEvent(
      'INFO',
      'Transcribe stage completed successfully, segment stage enqueued',
    );
  }

  private async loadChunkCheckpoint(
    key: string,
  ): Promise<GroqSegment[] | null> {
    try {
      const head = await this.s3.head(key);
      if (!head) return null;

      const stream = await this.s3.getObjectStream(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(
          typeof chunk === 'string'
            ? Buffer.from(chunk)
            : Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as Uint8Array),
        );
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      return JSON.parse(raw) as GroqSegment[];
    } catch {
      return null;
    }
  }

  private async processChunksWithConcurrency(
    indices: number[],
    chunks: { filePath: string; startSec: number; endSec: number }[],
    language: string,
    userId: string,
    videoId: string,
    concurrency: number,
    onChunkDone: (index: number, segments: GroqSegment[]) => Promise<void>,
  ): Promise<void> {
    let cursor = 0;
    const workerPool = Array.from(
      { length: Math.min(concurrency, indices.length) },
      async () => {
        while (cursor < indices.length) {
          const currentIdx = indices[cursor++];
          const chunk = chunks[currentIdx];

          let segments: GroqSegment[];
          try {
            segments = await this.transcription.transcribeChunk(
              chunk,
              language,
            );
          } catch (err: unknown) {
            this.classifyGroqError(err, chunk.filePath);
          }

          // Save chunk checkpoint to S3
          const checkpointKey = `users/${userId}/videos/${videoId}/transcripts/chunk-${currentIdx}.json`;
          await this.s3.putObject(
            checkpointKey,
            Buffer.from(JSON.stringify(segments)),
            'application/json',
          );

          await onChunkDone(currentIdx, segments);
        }
      },
    );

    await Promise.all(workerPool);
  }

  private classifyGroqError(error: unknown, chunkPath: string): never {
    if (error && typeof error === 'object') {
      const err = error as {
        status?: number;
        statusCode?: number;
        message?: string;
        headers?: Record<string, string | string[]> | Headers;
      };

      const status = err.status ?? err.statusCode;

      // 429: Rate Limit
      if (status === 429) {
        let retryAfter: string | null = null;
        if (err.headers && typeof (err.headers as Headers).get === 'function') {
          retryAfter = (err.headers as Headers).get('retry-after');
        } else if (err.headers && typeof err.headers === 'object') {
          const val = (err.headers as Record<string, string | string[]>)[
            'retry-after'
          ];
          retryAfter = Array.isArray(val) ? val[0] : val;
        }

        throw new RetryableJobError(
          `Groq transcription rate limit (429) for ${chunkPath}: ${err.message ?? 'Too many requests'}${retryAfter ? ` (Retry-After: ${retryAfter}s)` : ''}`,
          {
            code: 'RATE_LIMIT_EXCEEDED',
            details: { retryAfter },
            cause: error,
          },
        );
      }

      // 5xx: Server errors (temporary, retryable)
      if (typeof status === 'number' && status >= 500 && status < 600) {
        throw new RetryableJobError(
          `Groq transcription server error (${status}) for ${chunkPath}: ${err.message}`,
          { code: 'TRANSCRIBE_SERVER_ERROR', cause: error },
        );
      }

      // 4xx: Client errors (bad request, invalid model, invalid token, etc. - fatal)
      if (typeof status === 'number' && status >= 400 && status < 500) {
        throw new FatalJobError(
          `Groq transcription fatal client error (${status}) for ${chunkPath}: ${err.message}`,
          { code: JOB_ERROR_CODES.TRANSCRIBE_FAILED, cause: error },
        );
      }
    }

    // Default: rethrow or wrap in RetryableJobError
    throw new RetryableJobError(
      `Groq transcription failed for ${chunkPath}: ${error instanceof Error ? error.message : String(error)}`,
      { code: JOB_ERROR_CODES.TRANSCRIBE_FAILED, cause: error },
    );
  }
}
