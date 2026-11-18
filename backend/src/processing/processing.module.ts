import { Module } from '@nestjs/common';
import { ProcessingJobsService } from './processing-jobs.service';

@Module({
  providers: [ProcessingJobsService],
  exports: [ProcessingJobsService],
})
export class ProcessingModule {}
