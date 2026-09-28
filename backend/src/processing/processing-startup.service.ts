import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ProcessingJobsService } from './processing-jobs.service';

@Injectable()
export class ProcessingStartupService implements OnModuleInit {
  private readonly logger = new Logger(ProcessingStartupService.name);

  constructor(private readonly jobsService: ProcessingJobsService) {}

  onModuleInit() {
    void this.jobsService.recoverPersistedJobs().then((recovered) => {
      if (recovered > 0) {
        this.logger.log(`Re-queued ${recovered} persisted processing job(s)`);
      }
    });
  }
}
