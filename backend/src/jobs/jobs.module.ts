import { Global, Module } from '@nestjs/common';
import { JobReaperService } from './reaper/job-reaper.service';

@Global()
@Module({
  providers: [JobReaperService],
  exports: [JobReaperService],
})
export class JobsModule {}
