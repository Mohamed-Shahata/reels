import { ConflictException, NotFoundException } from '@nestjs/common';
import { AiClipRunsService } from '../../../src/clips/ai-clip-runs.service';
import type { ClipsService } from '../../../src/clips/clips.service';
import type { TopicSegmentationService } from '../../../src/segmentation/topic-segmentation.service';
import type { UsageService } from '../../../src/usage/usage.service';

const segments = [
  { title: 'Opening', startSec: 0, endSec: 30, summary: 'Opening topic.' },
];

function createService(
  overrides: {
    countAiClips?: jest.Mock;
    assertReady?: jest.Mock;
    reserveAiRun?: jest.Mock;
    suggest?: jest.Mock;
  } = {},
) {
  const clips = {
    countAiClips: overrides.countAiClips ?? jest.fn().mockResolvedValue(0),
    createAiSuggestions: jest.fn().mockResolvedValue([{ id: 'clip-1' }]),
  };
  const segmentation = {
    assertReady:
      overrides.assertReady ?? jest.fn().mockResolvedValue(undefined),
    suggest: overrides.suggest ?? jest.fn().mockResolvedValue(segments),
  };
  const usage = {
    reserveAiRun:
      overrides.reserveAiRun ?? jest.fn().mockResolvedValue(undefined),
  };
  const service = new AiClipRunsService(
    clips as unknown as ClipsService,
    segmentation as unknown as TopicSegmentationService,
    usage as unknown as UsageService,
  );
  return { service, clips, segmentation, usage };
}

describe('AiClipRunsService', () => {
  it('runs the pipeline once and counts the run for a video without AI clips', async () => {
    const { service, clips, segmentation, usage } = createService();

    await expect(service.run('user-1', 'video-1', {})).resolves.toEqual([
      { id: 'clip-1' },
    ]);

    expect(usage.reserveAiRun).toHaveBeenCalledWith('user-1');
    expect(segmentation.suggest).toHaveBeenCalledWith('user-1', 'video-1');
    expect(clips.createAiSuggestions).toHaveBeenCalledWith(
      'user-1',
      'video-1',
      segments,
      { replaceExisting: false },
    );
  });

  it('requires confirmation before replacing existing AI clips and spends nothing without it', async () => {
    const { service, segmentation, usage } = createService({
      countAiClips: jest.fn().mockResolvedValue(3),
    });

    await expect(service.run('user-1', 'video-1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      service.run('user-1', 'video-1', { confirmReplace: false }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(usage.reserveAiRun).not.toHaveBeenCalled();
    expect(segmentation.suggest).not.toHaveBeenCalled();
  });

  it('replaces existing AI clips once the user confirms', async () => {
    const { service, clips } = createService({
      countAiClips: jest.fn().mockResolvedValue(3),
    });

    await service.run('user-1', 'video-1', { confirmReplace: true });

    expect(clips.createAiSuggestions).toHaveBeenCalledWith(
      'user-1',
      'video-1',
      segments,
      { replaceExisting: true },
    );
  });

  it('does not count a run when the video or transcript is not ready', async () => {
    const { service, segmentation, usage } = createService({
      assertReady: jest
        .fn()
        .mockRejectedValue(new ConflictException('Transcript must be ready')),
    });

    await expect(service.run('user-1', 'video-1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(usage.reserveAiRun).not.toHaveBeenCalled();
    expect(segmentation.suggest).not.toHaveBeenCalled();
  });

  it('does not call the provider when the monthly limit is exhausted', async () => {
    const { service, segmentation, clips } = createService({
      reserveAiRun: jest.fn().mockRejectedValue(new Error('limit reached')),
    });

    await expect(service.run('user-1', 'video-1', {})).rejects.toThrow(
      'limit reached',
    );

    expect(segmentation.suggest).not.toHaveBeenCalled();
    expect(clips.createAiSuggestions).not.toHaveBeenCalled();
  });

  it('propagates ownership failures from the clips service', async () => {
    const { service, usage } = createService({
      countAiClips: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Video was not found')),
    });

    await expect(service.run('user-2', 'video-1', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(usage.reserveAiRun).not.toHaveBeenCalled();
  });
});
