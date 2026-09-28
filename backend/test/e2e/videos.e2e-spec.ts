import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import type { ErrorResponseBody } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StorageService } from '../../src/storage/storage.service';
import { createPrismaFake } from '../support/prisma-fake';

interface CreateVideoResponse {
  video: { id: string; title: string; status: string };
  upload: { publicId: string; resourceType: string };
}

describe('POST /api/v1/videos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: ReturnType<typeof createPrismaFake>;
  let storage: {
    createUploadSignature: jest.Mock;
    getUploadConstraints: jest.Mock;
    getVideoMetadata: jest.Mock;
    deleteVideo: jest.Mock;
    getClipPlaybackUrl: jest.Mock;
    getClipDownloadUrl: jest.Mock;
    getVideoPlaybackUrl: jest.Mock;
    getVideoPublicId: jest.Mock;
    getLegacyVideoPublicIds: jest.Mock;
  };

  beforeEach(async () => {
    prisma = createPrismaFake();
    storage = {
      createUploadSignature: jest.fn(({ publicId }: { publicId: string }) => ({
        uploadUrl: 'https://api.cloudinary.com/v1_1/demo/video/upload',
        cloudName: 'demo',
        apiKey: 'key',
        timestamp: 1,
        signature: 'signature',
        publicId,
        resourceType: 'video',
        allowedFormats: ['mp4', 'mov', 'webm'],
        maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
        maxDurationSec: 4 * 60 * 60,
      })),
      getUploadConstraints: jest.fn().mockReturnValue({
        allowedFormats: ['mp4', 'mov', 'webm'],
        maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
        maxDurationSec: 4 * 60 * 60,
      }),
      getVideoMetadata: jest.fn(),
      deleteVideo: jest.fn().mockResolvedValue(undefined),
      getClipPlaybackUrl: jest.fn().mockReturnValue('https://preview.example'),
      getClipDownloadUrl: jest.fn().mockReturnValue('https://download.example'),
      getVideoPlaybackUrl: jest.fn().mockReturnValue('https://video.example'),
      getVideoPublicId: jest.fn(
        (userId: string, videoId: string) =>
          `podcast-reels/uploads/${userId}/${videoId}`,
      ),
      getLegacyVideoPublicIds: jest.fn((userId: string, videoId: string) => [
        `videos/${userId}/${videoId}`,
        `podcast-reels/videos/${userId}/${videoId}`,
      ]),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  async function registerAndLogin(email: string): Promise<string> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'secret-pass-1' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret-pass-1' })
      .expect(200);

    return (response.headers['set-cookie'] as unknown as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  }

  it('creates an uploading video and returns a signed upload scoped to its owner', async () => {
    const cookies = await registerAndLogin('user@example.com');

    const response = await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', cookies)
      .send({ title: '  Episode 42  ' })
      .expect(201);

    const body = response.body as unknown as CreateVideoResponse;

    expect(body).toMatchObject({
      video: {
        id: 'video-1',
        title: 'Episode 42',
        status: 'UPLOADING',
      },
      upload: {
        publicId: 'podcast-reels/uploads/user-1/video-1',
        resourceType: 'video',
      },
    });
    expect(body.upload).not.toHaveProperty('apiSecret');
    expect(prisma.videos).toEqual([
      expect.objectContaining({
        id: 'video-1',
        userId: 'user-1',
        status: 'UPLOADING',
      }),
    ]);
  });

  it('returns the configured upload constraints to authenticated users', async () => {
    const cookies = await registerAndLogin('user@example.com');

    await request(app.getHttpServer())
      .get('/api/v1/videos/upload-constraints')
      .set('Cookie', cookies)
      .expect(200)
      .expect({
        allowedFormats: ['mp4', 'mov', 'webm'],
        maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
        maxDurationSec: 4 * 60 * 60,
      });

    expect(storage.getUploadConstraints).toHaveBeenCalledTimes(1);
  });

  it('scopes each signature to the authenticated user', async () => {
    const firstUser = await registerAndLogin('first@example.com');
    const first = await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', firstUser)
      .send({ title: 'First episode' })
      .expect(201);
    const secondUser = await registerAndLogin('second@example.com');
    const second = await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', secondUser)
      .send({ title: 'Second episode' })
      .expect(201);

    const firstBody = first.body as unknown as CreateVideoResponse;
    const secondBody = second.body as unknown as CreateVideoResponse;

    expect(firstBody.upload.publicId).toBe(
      'podcast-reels/uploads/user-1/video-1',
    );
    expect(secondBody.upload.publicId).toBe(
      'podcast-reels/uploads/user-2/video-2',
    );
  });

  it('lists only the authenticated user videos and allows the owner to rename one', async () => {
    const owner = await registerAndLogin('owner@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', owner)
      .send({ title: 'Owner episode' })
      .expect(201);
    const otherUser = await registerAndLogin('other@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', otherUser)
      .send({ title: 'Other episode' })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/videos')
      .set('Cookie', owner)
      .expect(200);

    expect(listed.body).toEqual([
      expect.objectContaining({ id: 'video-1', title: 'Owner episode' }),
    ]);

    const renamed = await request(app.getHttpServer())
      .patch('/api/v1/videos/video-1')
      .set('Cookie', owner)
      .send({ title: 'Renamed episode' })
      .expect(200);

    expect(renamed.body).toMatchObject({ title: 'Renamed episode' });

    await request(app.getHttpServer())
      .patch('/api/v1/videos/video-1')
      .set('Cookie', otherUser)
      .send({ title: 'Not allowed' })
      .expect(404);
  });

  it('deletes an owned stored asset and video record', async () => {
    const cookies = await registerAndLogin('user@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', cookies)
      .send({ title: 'Episode 42' })
      .expect(201);
    storage.getVideoMetadata.mockResolvedValue({
      publicId: 'podcast-reels/uploads/user-1/video-1',
      durationSec: 64.5,
      bytes: 123456n,
    });
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/complete')
      .set('Cookie', cookies)
      .expect(200);

    await request(app.getHttpServer())
      .delete('/api/v1/videos/video-1')
      .set('Cookie', cookies)
      .expect(204);

    expect(storage.deleteVideo).toHaveBeenCalledWith(
      'podcast-reels/uploads/user-1/video-1',
    );
    expect(prisma.videos).toHaveLength(0);
  });

  it('returns a fresh signature only to the owner of a pending upload', async () => {
    const owner = await registerAndLogin('owner@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', owner)
      .send({ title: 'Episode 42' })
      .expect(201);

    const resumed = await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/upload-signature')
      .set('Cookie', owner)
      .expect(200);
    const body = resumed.body as unknown as CreateVideoResponse['upload'];

    expect(body.publicId).toBe('podcast-reels/uploads/user-1/video-1');

    const otherUser = await registerAndLogin('other@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/upload-signature')
      .set('Cookie', otherUser)
      .expect(404);
  });

  it('only marks a video ready after Cloudinary verifies the stored asset', async () => {
    const cookies = await registerAndLogin('user@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', cookies)
      .send({ title: 'Episode 42' })
      .expect(201);
    storage.getVideoMetadata.mockResolvedValue({
      publicId: 'podcast-reels/uploads/user-1/video-1',
      durationSec: 64.5,
      bytes: 123456n,
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/complete')
      .set('Cookie', cookies)
      .expect(200);

    expect(response.body).toMatchObject({
      id: 'video-1',
      cloudinaryId: 'podcast-reels/uploads/user-1/video-1',
      durationSec: 64.5,
      sizeBytes: '123456',
      status: 'READY',
    });
    expect(prisma.videos[0]).toMatchObject({
      cloudinaryId: 'podcast-reels/uploads/user-1/video-1',
      status: 'READY',
    });
    expect(prisma.usageRecords).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        uploadedSeconds: 64.5,
        clipCount: 0,
      }),
    ]);
  });

  it('returns the authenticated user monthly usage after uploads and clips', async () => {
    const cookies = await registerAndLogin('user@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', cookies)
      .send({ title: 'Episode 42' })
      .expect(201);
    storage.getVideoMetadata.mockResolvedValue({
      publicId: 'podcast-reels/uploads/user-1/video-1',
      durationSec: 120,
      bytes: 123456n,
    });
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/complete')
      .set('Cookie', cookies)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/clips')
      .set('Cookie', cookies)
      .send({ title: 'First clip', startSec: 10, endSec: 30 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/clips')
      .set('Cookie', cookies)
      .send({ title: 'Second clip', startSec: 35, endSec: 55 })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v1/usage?month=2026-09')
      .set('Cookie', cookies)
      .expect(200);
    expect(response.body).toEqual({
      month: '2026-09',
      uploadedMinutes: 2,
      clipCount: 2,
    });

    const otherUser = await registerAndLogin('other@example.com');
    await request(app.getHttpServer())
      .get('/api/v1/usage?month=2026-09')
      .set('Cookie', otherUser)
      .expect(200)
      .expect({ month: '2026-09', uploadedMinutes: 0, clipCount: 0 });
  });

  it('completes the local MVP flow for a one-hour video and five downloads', async () => {
    const cookies = await registerAndLogin('mvp@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', cookies)
      .send({ title: 'One-hour podcast' })
      .expect(201);

    storage.getVideoMetadata.mockResolvedValue({
      publicId: 'podcast-reels/uploads/user-1/video-1',
      durationSec: 60 * 60,
      bytes: 250_000_000n,
    });
    const completed = await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/complete')
      .set('Cookie', cookies)
      .expect(200);
    expect(completed.body).toEqual(
      expect.objectContaining({ durationSec: 3600, status: 'READY' }),
    );

    for (let index = 0; index < 5; index += 1) {
      const startSec = 60 + index * 120;
      await request(app.getHttpServer())
        .post('/api/v1/videos/video-1/clips')
        .set('Cookie', cookies)
        .send({
          title: `Highlight ${index + 1}`,
          startSec,
          endSec: startSec + 30,
        })
        .expect(201);
    }

    const clips = await request(app.getHttpServer())
      .get('/api/v1/videos/video-1/clips')
      .set('Cookie', cookies)
      .expect(200);
    expect(clips.body).toHaveLength(5);

    for (const clip of clips.body as { id: string }[]) {
      await request(app.getHttpServer())
        .get(`/api/v1/clips/${clip.id}/download`)
        .set('Cookie', cookies)
        .expect(200)
        .expect({ url: 'https://download.example' });
    }

    expect(storage.getClipDownloadUrl).toHaveBeenCalledTimes(5);
    expect(prisma.usageRecords).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        uploadedSeconds: 3600,
        clipCount: 5,
      }),
    ]);
  });

  it('creates, lists, updates and deletes clips for an owned ready video', async () => {
    const cookies = await registerAndLogin('user@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', cookies)
      .send({ title: 'Episode 42' })
      .expect(201);
    storage.getVideoMetadata.mockResolvedValue({
      publicId: 'podcast-reels/uploads/user-1/video-1',
      durationSec: 64.5,
      bytes: 123456n,
    });
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/complete')
      .set('Cookie', cookies)
      .expect(200);

    const created = await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/clips')
      .set('Cookie', cookies)
      .send({ title: '  Key takeaway  ', startSec: 10, endSec: 30 })
      .expect(201);

    expect(created.body).toMatchObject({
      id: 'clip-1',
      videoId: 'video-1',
      title: 'Key takeaway',
      startSec: 10,
      endSec: 30,
    });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/videos/video-1/clips')
      .set('Cookie', cookies)
      .expect(200);
    expect(listed.body).toEqual([
      expect.objectContaining({ id: 'clip-1', title: 'Key takeaway' }),
    ]);

    const updated = await request(app.getHttpServer())
      .patch('/api/v1/clips/clip-1')
      .set('Cookie', cookies)
      .send({ endSec: 35 })
      .expect(200);
    expect(updated.body).toEqual(expect.objectContaining({ endSec: 35 }));

    await request(app.getHttpServer())
      .delete('/api/v1/clips/clip-1')
      .set('Cookie', cookies)
      .expect(204);
    expect(prisma.clips).toHaveLength(0);
  });

  it('returns preview and download URLs only to the clip owner', async () => {
    const owner = await registerAndLogin('owner@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', owner)
      .send({ title: 'Episode 42' })
      .expect(201);
    storage.getVideoMetadata.mockResolvedValue({
      publicId: 'podcast-reels/uploads/user-1/video-1',
      durationSec: 64.5,
      bytes: 123456n,
    });
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/complete')
      .set('Cookie', owner)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/clips')
      .set('Cookie', owner)
      .send({ title: 'Valid range', startSec: 10, endSec: 30 })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/v1/clips/clip-1/playback')
      .set('Cookie', owner)
      .expect(200)
      .expect({ url: 'https://preview.example' });
    await request(app.getHttpServer())
      .get('/api/v1/clips/clip-1/download')
      .set('Cookie', owner)
      .expect(200)
      .expect({ url: 'https://download.example' });

    const otherUser = await registerAndLogin('other@example.com');
    await request(app.getHttpServer())
      .get('/api/v1/clips/clip-1/playback')
      .set('Cookie', otherUser)
      .expect(404);
  });

  it('returns an original playback URL only to the ready video owner', async () => {
    const owner = await registerAndLogin('owner@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', owner)
      .send({ title: 'Episode 42' })
      .expect(201);
    storage.getVideoMetadata.mockResolvedValue({
      publicId: 'podcast-reels/uploads/user-1/video-1',
      durationSec: 64.5,
      bytes: 123456n,
    });
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/complete')
      .set('Cookie', owner)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/videos/video-1/playback')
      .set('Cookie', owner)
      .expect(200)
      .expect({ url: 'https://video.example' });

    const otherUser = await registerAndLogin('other@example.com');
    await request(app.getHttpServer())
      .get('/api/v1/videos/video-1/playback')
      .set('Cookie', otherUser)
      .expect(404);
  });

  it('rejects invalid clip ranges and cross-user clip access', async () => {
    const owner = await registerAndLogin('owner@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', owner)
      .send({ title: 'Episode 42' })
      .expect(201);
    storage.getVideoMetadata.mockResolvedValue({
      publicId: 'podcast-reels/uploads/user-1/video-1',
      durationSec: 64.5,
      bytes: 123456n,
    });
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/complete')
      .set('Cookie', owner)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/clips')
      .set('Cookie', owner)
      .send({ title: 'Too short', startSec: 10, endSec: 14 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/clips')
      .set('Cookie', owner)
      .send({ title: 'Valid range', startSec: 10, endSec: 30 })
      .expect(201);

    const otherUser = await registerAndLogin('other@example.com');
    await request(app.getHttpServer())
      .get('/api/v1/videos/video-1/clips')
      .set('Cookie', otherUser)
      .expect(404);
    await request(app.getHttpServer())
      .patch('/api/v1/clips/clip-1')
      .set('Cookie', otherUser)
      .send({ title: 'Not allowed' })
      .expect(404);
    await request(app.getHttpServer())
      .delete('/api/v1/clips/clip-1')
      .set('Cookie', otherUser)
      .expect(404);
  });

  it('marks the pending video failed when Cloudinary cannot verify it', async () => {
    const cookies = await registerAndLogin('user@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', cookies)
      .send({ title: 'Episode 42' })
      .expect(201);
    storage.getVideoMetadata.mockRejectedValue(new Error('not found'));

    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/complete')
      .set('Cookie', cookies)
      .expect(400);

    expect(prisma.videos[0].status).toBe('FAILED');
  });

  it('rejects unauthenticated and invalid create requests', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/videos')
      .send({ title: 'Episode 42' })
      .expect(401);

    const cookies = await registerAndLogin('user@example.com');
    const response = await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', cookies)
      .send({ title: '   ', extra: true })
      .expect(400);

    expect((response.body as ErrorResponseBody).details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title' }),
        expect.objectContaining({ field: 'extra' }),
      ]),
    );
    expect(prisma.videos).toHaveLength(0);
  });
});
