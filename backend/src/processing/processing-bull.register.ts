import { BullModule } from '@nestjs/bullmq';
import { DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { BullProcessingQueueService } from './bull-processing-queue.service';
import {
  PROCESSING_QUEUE,
  PROCESSING_QUEUE_NAME,
} from './processing.constants';
import { ProcessingJobsService } from './processing-jobs.service';
import { ProcessingProcessor } from './processing.processor';
import { ProcessingStartupService } from './processing-startup.service';
import { ProcessingModule } from './processing.module';
import { ClipsModule } from '../clips/clips.module';
import { RendersModule } from '../renders/renders.module';
import { TranscriptionModule } from '../transcription/transcription.module';

export function buildProcessingBullModule(): DynamicModule {
  return {
    global: true,
    module: ProcessingModule,
    imports: [
      TranscriptionModule,
      RendersModule,
      ClipsModule,
      BullModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService<Env, true>) => ({
          connection: {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            url: config.get('REDIS_URL', { infer: true }),
            maxRetriesPerRequest: null,
          },
        }),
      }),
      BullModule.registerQueue({ name: PROCESSING_QUEUE_NAME }),
    ],
    providers: [
      ProcessingJobsService,
      ProcessingStartupService,
      BullProcessingQueueService,
      ProcessingProcessor,
      {
        provide: PROCESSING_QUEUE,
        useExisting: BullProcessingQueueService,
      },
    ],
    exports: [ProcessingJobsService],
  };
}
