import type { Response } from 'express';
import { ClipsController } from '../../../src/clips/clips.controller';
import type { ClipsService } from '../../../src/clips/clips.service';
import type { AiClipRunsService } from '../../../src/clips/ai-clip-runs.service';

describe('ClipsController', () => {
  let controller: ClipsController;
  let clipsService: jest.Mocked<Partial<ClipsService>>;
  let aiRunsService: jest.Mocked<Partial<AiClipRunsService>>;

  beforeEach(() => {
    clipsService = {
      create: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      split: jest.fn(),
      merge: jest.fn(),
      remove: jest.fn(),
      getPlaybackUrl: jest.fn(),
      getDownloadUrl: jest.fn(),
      downloadClipFile: jest.fn(),
      serveThumbnail: jest.fn(),
    };
    aiRunsService = {
      run: jest.fn(),
    };
    controller = new ClipsController(
      clipsService as ClipsService,
      aiRunsService as AiClipRunsService,
    );
  });

  describe('thumbnail', () => {
    it('delegates thumbnail serving to clipsService.serveThumbnail', async () => {
      const res = {
        type: jest.fn(),
        redirect: jest.fn(),
      } as unknown as Response;

      (clipsService.serveThumbnail as jest.Mock).mockResolvedValue(undefined);

      await controller.thumbnail('clip-123', res);

      expect(clipsService.serveThumbnail).toHaveBeenCalledTimes(1);
      expect(clipsService.serveThumbnail).toHaveBeenCalledWith('clip-123', res);
    });
  });
});
