import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  PROCESSING_QUEUE_NAME,
  type ProcessingQueueJobPayload,
} from './processing.constants';
import { ProcessingJobsService } from './processing-jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { TranscriptionService } from '../transcription/transcription.service';
@Processor(PROCESSING_QUEUE_NAME)
export class ProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(ProcessingProcessor.name);

  constructor(
    private readonly jobsService: ProcessingJobsService,
    private readonly prisma: PrismaService,
    private readonly transcriptionService: TranscriptionService,
  ) {
    super();
  }

  async process(job: Job<ProcessingQueueJobPayload>): Promise<void> {
    const { processingJobId } = job.data;
    await this.jobsService.markRunning(processingJobId);

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
      }

      await this.jobsService.markCompleted(processingJobId);
    } catch (error) {
      await this.jobsService.markFailed(processingJobId, error);
      this.logger.error(
        `Processing job ${processingJobId} failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw error;
    }
  }
}
