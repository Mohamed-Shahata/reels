import type { Job } from 'bullmq';

jest.mock('@nestjs/bullmq', () => ({
  Processor: () => () => undefined,
  WorkerHost: class {},
}));

import type { AiClipRunsService } from '../../../src/clips/ai-clip-runs.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { ProcessingQueueJobPayload } from '../../../src/processing/processing.constants';
import type { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';
import { ProcessingProcessor } from '../../../src/processing/processing.processor';
import type { ClipRenderExecutorService } from '../../../src/renders/clip-render-executor.service';
import type { TranscriptionService } from '../../../src/transcription/transcription.service';

function setup(options: { autoClips: boolean; runs?: jest.Mock }) {
  const jobsService = {
    markRunning: jest.fn().mockResolvedValue(undefined),
    getById: jest.fn().mockResolvedValue({
      id: 'job-1',
      type: 'TRANSCRIPTION',
      videoId: 'video-1',
      payload: { language: 'en' },
    }),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    video: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'video-1',
        userId: 'user-1',
        cloudinaryId: 'videos/user-1/video-1',
        autoClips: options.autoClips,
      }),
    },
  };
  const transcription = {
    extractAudio: jest.fn().mockResolvedValue('/tmp/a.mp3'),
    chunkAudio: jest.fn().mockResolvedValue([{ index: 0 }]),
    transcribeChunks: jest.fn().mockResolvedValue([[]]),
    mergeAndStore: jest.fn().mockResolvedValue(undefined),
    cleanupTempFiles: jest.fn().mockResolvedValue(undefined),
  };
  const aiRuns = { run: options.runs ?? jest.fn().mockResolvedValue([{}, {}]) };
  const processor = new ProcessingProcessor(
    jobsService as unknown as ProcessingJobsService,
    prisma as unknown as PrismaService,
    transcription as unknown as TranscriptionService,
    {} as ClipRenderExecutorService,
    aiRuns as unknown as AiClipRunsService,
  );
  const bullJob = {
    data: { processingJobId: 'job-1', type: 'TRANSCRIPTION' },
  } as Job<ProcessingQueueJobPayload>;
  return { processor, jobsService, transcription, aiRuns, bullJob };
}

describe('ProcessingProcessor automatic clip detection', () => {
  it('transcribes in the video language and runs AI clips when enabled', async () => {
    const { processor, transcription, aiRuns, jobsService, bullJob } = setup({
      autoClips: true,
    });

    await processor.process(bullJob);

    expect(transcription.transcribeChunks).toHaveBeenCalledWith(
      expect.anything(),
      'en',
      expect.any(Function),
    );
    expect(jobsService.markCompleted).toHaveBeenCalledWith('job-1');
    expect(aiRuns.run).toHaveBeenCalledWith('user-1', 'video-1', {});
  });

  it('does not run AI clips when the option is off', async () => {
    const { processor, aiRuns, bullJob } = setup({ autoClips: false });

    await processor.process(bullJob);

    expect(aiRuns.run).not.toHaveBeenCalled();
  });

  it('keeps the transcription completed when the AI run is rejected', async () => {
    const runs = jest.fn().mockRejectedValue(new Error('AI run limit reached'));
    const { processor, jobsService, bullJob } = setup({
      autoClips: true,
      runs,
    });

    await expect(processor.process(bullJob)).resolves.toBeUndefined();

    expect(jobsService.markCompleted).toHaveBeenCalledWith('job-1');
    expect(jobsService.markFailed).not.toHaveBeenCalled();
  });
});
