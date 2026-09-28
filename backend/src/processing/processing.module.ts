import { DynamicModule, Module } from '@nestjs/common';
import { InMemoryProcessingQueueService } from './in-memory-processing-queue.service';
import { PROCESSING_QUEUE } from './processing.constants';
import { ProcessingJobsService } from './processing-jobs.service';
import { ProcessingStartupService } from './processing-startup.service';
import { TranscriptionModule } from '../transcription/transcription.module';

@Module({})
export class ProcessingModule {
  static register(): DynamicModule {
    if (process.env.NODE_ENV === 'test') {
      return {
        global: true,
        module: ProcessingModule,
        imports: [TranscriptionModule],
        providers: [
          ProcessingJobsService,
          ProcessingStartupService,
          InMemoryProcessingQueueService,
          {
            provide: PROCESSING_QUEUE,
            useExisting: InMemoryProcessingQueueService,
          },
        ],
        exports: [ProcessingJobsService],
      };
    }

    const { buildProcessingBullModule } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./processing-bull.register') as {
        buildProcessingBullModule: () => DynamicModule;
      };

    return buildProcessingBullModule();
  }
}
