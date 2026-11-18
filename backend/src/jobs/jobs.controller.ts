import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { ProcessingJobsService } from '../processing/processing-jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: ProcessingJobsService) {}

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  async retry(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    const job = await this.jobs.retryJob(id, auth.userId);
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      errorCode: job.errorCode,
      lastError: job.lastError,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    const job = await this.jobs.cancelJob(id, auth.userId);
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      errorCode: job.errorCode,
      lastError: job.lastError,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
