import type { Job } from 'bullmq';

jest.mock('@nestjs/bullmq', () => ({
  Processor: () => () => undefined,
  WorkerHost: class {},
}));

import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { ProcessingQueueJobPayload } from '../../../src/processing/processing.constants';
import type { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';
import { ProcessingProcessor } from '../../../src/processing/processing.processor';
import type { ClipRenderExecutorService } from '../../../src/renders/clip-render-executor.service';
import type { TranscriptionService } from '../../../src/transcription/transcription.service';

function createProcessor(job: Record<string, unknown>) {
  const jobsService = {
    markRunning: jest.fn().mockResolvedValue(undefined),
    getById: jest.fn().mockResolvedValue(job),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
  const renderExecutor = { execute: jest.fn() };
  const processor = new ProcessingProcessor(
    jobsService as unknown as ProcessingJobsService,
    {} as PrismaService,
    {} as TranscriptionService,
    renderExecutor as unknown as ClipRenderExecutorService,
  );
  const bullJob = {
    data: { processingJobId: 'job-1', type: 'RENDER' },
  } as Job<ProcessingQueueJobPayload>;
  return { processor, jobsService, renderExecutor, bullJob };
}

describe('ProcessingProcessor render jobs', () => {
  it('runs the render executor and completes the job', async () => {
    const { processor, jobsService, renderExecutor, bullJob } = createProcessor(
      { id: 'job-1', type: 'RENDER', payload: { clipRenderId: 'render-1' } },
    );
    renderExecutor.execute.mockImplementation(
      async (_id: string, onProgress: (value: number) => Promise<void>) => {
        await onProgress(30);
        return 'https://reel.example';
      },
    );

    await processor.process(bullJob);

    expect(renderExecutor.execute).toHaveBeenCalledWith(
      'render-1',
      expect.any(Function),
    );
    expect(jobsService.updateProgress).toHaveBeenCalledWith('job-1', 30);
    expect(jobsService.markCompleted).toHaveBeenCalledWith('job-1');
    expect(jobsService.markFailed).not.toHaveBeenCalled();
  });

  it('marks the job failed and rethrows so the render can be retried', async () => {
    const { processor, jobsService, renderExecutor, bullJob } = createProcessor(
      { id: 'job-1', type: 'RENDER', payload: { clipRenderId: 'render-1' } },
    );
    const failure = new Error('Timed out waiting for the reel to render');
    renderExecutor.execute.mockRejectedValue(failure);

    await expect(processor.process(bullJob)).rejects.toBe(failure);

    expect(jobsService.markFailed).toHaveBeenCalledWith('job-1', failure);
    expect(jobsService.markCompleted).not.toHaveBeenCalled();
  });

  it('fails a render job that has no clipRenderId in its payload', async () => {
    const { processor, jobsService, renderExecutor, bullJob } = createProcessor(
      { id: 'job-1', type: 'RENDER', payload: null },
    );

    await expect(processor.process(bullJob)).rejects.toThrow(
      'RENDER job requires clipRenderId',
    );
    expect(renderExecutor.execute).not.toHaveBeenCalled();
    expect(jobsService.markFailed).toHaveBeenCalled();
  });
});
