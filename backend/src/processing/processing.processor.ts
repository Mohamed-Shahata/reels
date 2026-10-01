import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  isStoppedJob,
  PROCESSING_QUEUE_NAME,
  type ProcessingQueueJobPayload,
} from './processing.constants';
import { ProcessingJobsService } from './processing-jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClipRenderExecutorService,
  RenderStoppedError,
} from '../renders/clip-render-executor.service';
import { TranscriptionService } from '../transcription/transcription.service';
import { AiClipRunsService } from '../clips/ai-clip-runs.service';
import { describeError, toError } from '../common/errors/describe-error';
@Processor(PROCESSING_QUEUE_NAME)
export class ProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(ProcessingProcessor.name);

  constructor(
    private readonly jobsService: ProcessingJobsService,
    private readonly prisma: PrismaService,
    private readonly transcriptionService: TranscriptionService,
    private readonly renderExecutor: ClipRenderExecutorService,
    private readonly aiClipRuns: AiClipRunsService,
  ) {
    super();
  }

  async process(job: Job<ProcessingQueueJobPayload>): Promise<void> {
    const { processingJobId } = job.data;

    // The user stopped the job while it was still waiting in the queue.
    if (isStoppedJob(await this.jobsService.getById(processingJobId))) {
      this.logger.log(`Processing job ${processingJobId} was stopped`);
      return;
    }

    await this.jobsService.markRunning(processingJobId);
    let autoClipTarget: { userId: string; videoId: string } | null = null;

    try {
      const processingJob = await this.jobsService.getById(processingJobId);

      if (processingJob.type === 'TRANSCRIPTION') {
        if (!processingJob.videoId) {
          throw new Error('TRANSCRIPTION job requires videoId');
        }

        const video = await this.prisma.video.findUnique({
          where: { id: processingJob.videoId },
        });

        if (!video?.cloudinaryId) {
          throw new Error('Video not found or not uploaded to Cloudinary');
        }

        const language =
          (processingJob.payload as Record<string, string> | null)?.language ??
          'ar';

        // 5.2 Audio Extraction
        const audioPath = await this.transcriptionService.extractAudio(
          video.id,
          video.cloudinaryId,
        );

        // 5.3 Audio chunking
        const chunks = await this.transcriptionService.chunkAudio(
          audioPath,
          video.id,
        );
        this.logger.debug(
          `Generated ${chunks.length} chunks for video ${video.id}`,
        );

        // 5.4 + 5.5 Groq transcription with retry
        await this.jobsService.updateProgress(processingJobId, 10);

        const chunkSegments = await this.transcriptionService.transcribeChunks(
          chunks,
          language,
          (progress) =>
            this.jobsService
              .updateProgress(processingJobId, progress)
              .then(() => {}),
        );

        // 5.6 Merge & store
        await this.transcriptionService.mergeAndStore(
          video.id,
          chunks,
          chunkSegments,
          language,
        );

        // Cleanup temp files
        await this.transcriptionService.cleanupTempFiles(video.id, audioPath);

        if (video.autoClips) {
          autoClipTarget = { userId: video.userId, videoId: video.id };
        }
      }

      if (processingJob.type === 'RENDER') {
        const clipRenderId = (
          processingJob.payload as { clipRenderId?: string } | null
        )?.clipRenderId;
        if (!clipRenderId) {
          throw new Error('RENDER job requires clipRenderId');
        }

        await this.renderExecutor.execute(
          clipRenderId,
          async (progress) => {
            await this.jobsService.updateProgress(processingJobId, progress);
          },
          async () =>
            isStoppedJob(await this.jobsService.getById(processingJobId)),
        );
      }

      await this.jobsService.markCompleted(processingJobId);

      if (autoClipTarget) {
        await this.runAutoClips(autoClipTarget.userId, autoClipTarget.videoId);
      }
    } catch (error) {
      if (error instanceof RenderStoppedError) {
        // Already stored as stopped by stopJob; nothing to mark or retry.
        this.logger.log(`Render job ${processingJobId} was stopped`);
        return;
      }
      await this.jobsService.markFailed(processingJobId, error);
      this.logger.error(
        `Processing job ${processingJobId} failed: ${describeError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw toError(error);
    }
  }

  private async runAutoClips(userId: string, videoId: string): Promise<void> {
    try {
      const clips = await this.aiClipRuns.run(userId, videoId, {});
      this.logger.log(
        `Auto clip detection created ${clips.length} clips for video ${videoId}`,
      );
    } catch (error) {
      // The transcript is already stored; a failed or skipped auto run (for
      // example the monthly AI limit) must not fail the transcription job.
      this.logger.warn(
        `Auto clip detection skipped for video ${videoId}: ${describeError(error)}`,
      );
    }
  }
}
