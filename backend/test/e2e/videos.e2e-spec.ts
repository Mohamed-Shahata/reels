import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import type { ErrorResponseBody } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createPrismaFake } from '../support/prisma-fake';

interface CreateVideoResponse {
  video: { id: string; title: string; status: string };
  upload: { publicId: string; resourceType: string };
}

describe('POST /api/v1/videos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: ReturnType<typeof createPrismaFake>;

  beforeEach(async () => {
    prisma = createPrismaFake();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
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
        publicId: 'videos/user-1/video-1',
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

    expect(firstBody.upload.publicId).toBe('videos/user-1/video-1');
    expect(secondBody.upload.publicId).toBe('videos/user-2/video-2');
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

    expect(body.publicId).toBe('videos/user-1/video-1');

    const otherUser = await registerAndLogin('other@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/videos/video-1/upload-signature')
      .set('Cookie', otherUser)
      .expect(404);
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
