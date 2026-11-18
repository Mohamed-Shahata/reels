import { VideosController } from '../../../src/videos/videos.controller';
import { VideosService } from '../../../src/videos/videos.service';
import type { AuthContext } from '../../../src/auth/jwt-auth.guard';

describe('VideosController Upload Endpoints', () => {
  let controller: VideosController;
  let videosService: {
    createUpload: jest.Mock;
    getUploadStatus: jest.Mock;
    presignParts: jest.Mock;
    completeUpload: jest.Mock;
    getUploadConstraints: jest.Mock;
    getProcessingJobs: jest.Mock;
    list: jest.Mock;
    listLibrary: jest.Mock;
    findOne: jest.Mock;
    getReframePlan: jest.Mock;
    rename: jest.Mock;
    remove: jest.Mock;
  };

  const auth: AuthContext = {
    userId: 'user-123',
    sessionId: 'session-123',
  };

  beforeEach(() => {
    videosService = {
      createUpload: jest.fn(),
      getUploadStatus: jest.fn(),
      presignParts: jest.fn(),
      completeUpload: jest.fn(),
      getUploadConstraints: jest.fn(),
      getProcessingJobs: jest.fn(),
      list: jest.fn(),
      listLibrary: jest.fn(),
      findOne: jest.fn(),
      getReframePlan: jest.fn(),
      rename: jest.fn(),
      remove: jest.fn(),
    };

    controller = new VideosController(
      videosService as unknown as VideosService,
    );
  });

  it('delegates POST /videos to videosService.createUpload', async () => {
    const dto = {
      title: 'Ep 1',
      contentType: 'PODCAST' as const,
      filename: 'ep1.mp4',
    };
    videosService.createUpload.mockResolvedValue({
      video: { id: 'v1' },
      upload: { uploadId: 'up-1' },
    });

    const res = await controller.create(auth, dto);

    expect(videosService.createUpload).toHaveBeenCalledWith(
      'user-123',
      'Ep 1',
      dto,
    );
    expect(res).toEqual({
      video: { id: 'v1' },
      upload: { uploadId: 'up-1' },
    });
  });

  it('delegates GET /videos/:id/upload to videosService.getUploadStatus', async () => {
    videosService.getUploadStatus.mockResolvedValue({
      videoId: 'v1',
      uploadId: 'up-1',
      parts: [],
    });

    const res = await controller.getUploadStatus(auth, 'v1', 'up-1');

    expect(videosService.getUploadStatus).toHaveBeenCalledWith(
      'user-123',
      'v1',
      'up-1',
    );
    expect(res.videoId).toBe('v1');
  });

  it('delegates POST /videos/:id/upload/parts to videosService.presignParts', async () => {
    videosService.presignParts.mockResolvedValue({
      parts: [{ partNumber: 1, url: 'https://...' }],
    });

    const res = await controller.presignParts(auth, 'v1', {
      uploadId: 'up-1',
      partNumbers: [1, 2],
    });

    expect(videosService.presignParts).toHaveBeenCalledWith(
      'user-123',
      'v1',
      'up-1',
      [1, 2],
    );
    expect(res.parts).toHaveLength(1);
  });

  it('delegates POST /videos/:id/complete to videosService.completeUpload', async () => {
    const dto = {
      uploadId: 'up-1',
      parts: [{ partNumber: 1, eTag: 'etag-1' }],
    };
    videosService.completeUpload.mockResolvedValue({
      id: 'v1',
      status: 'READY',
    });

    const res = await controller.complete(auth, 'v1', dto);

    expect(videosService.completeUpload).toHaveBeenCalledWith(
      'user-123',
      'v1',
      dto,
    );
    expect(res.status).toBe('READY');
  });

  it('delegates GET /videos/:id to videosService.findOne', async () => {
    videosService.findOne.mockResolvedValue({
      id: 'v1',
      title: 'Episode 1',
      pipeline: [{ stage: 'INGEST', status: 'COMPLETED' }],
    });

    const res = await controller.findOne(auth, 'v1');

    expect(videosService.findOne).toHaveBeenCalledWith('user-123', 'v1');
    expect(res.id).toBe('v1');
    expect(res.pipeline).toHaveLength(1);
  });

  it('delegates GET /videos/:id/reframe to videosService.getReframePlan', async () => {
    videosService.getReframePlan.mockResolvedValue({
      id: 'plan-1',
      videoId: 'v1',
      version: 1,
      contentType: 'SOLO',
      faces: [],
    });

    const res = await controller.getReframePlan(auth, 'v1');

    expect(videosService.getReframePlan).toHaveBeenCalledWith('user-123', 'v1');
    expect(res.id).toBe('plan-1');
  });

  it('delegates GET /videos/:id/transcript.:format to videosService.exportTranscript', async () => {
    (videosService as any).exportTranscript = jest.fn().mockResolvedValue({
      content: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello',
      filename: 'ep1.vtt',
      contentType: 'text/vtt; charset=utf-8',
    });

    const res: any = {
      setHeader: jest.fn(),
      send: jest.fn().mockImplementation((val) => val),
    };

    const out = await controller.exportTranscript(auth, 'v1', 'vtt', res);

    expect((videosService as any).exportTranscript).toHaveBeenCalledWith(
      'user-123',
      'v1',
      'vtt',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/vtt; charset=utf-8',
    );
    expect(out).toContain('WEBVTT');
  });

  it('throws BadRequestException for unsupported transcript format', async () => {
    const res: any = { setHeader: jest.fn(), send: jest.fn() };
    await expect(
      controller.exportTranscript(auth, 'v1', 'docx', res),
    ).rejects.toThrow('Unsupported transcript format');
  });
});
