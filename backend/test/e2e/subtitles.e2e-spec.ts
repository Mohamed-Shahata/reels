import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createPrismaFake } from '../support/prisma-fake';

describe('GET /api/v1/clips/:id/subtitles (e2e)', () => {
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

  // The first registered user is `user-1`; give them a ready video and a clip.
  function seedClip(): void {
    const now = new Date();
    prisma.videos.push({
      id: 'video-1',
      userId: 'user-1',
      title: 'Episode',
      status: 'READY',
      durationSec: 600,
      createdAt: now,
      updatedAt: now,
    });
    prisma.clips.push({
      id: 'clip-1',
      videoId: 'video-1',
      title: 'Intro',
      startSec: 100,
      endSec: 110,
      source: 'MANUAL',
      createdAt: now,
      updatedAt: now,
    });
  }

  function seedTranscript(): void {
    const findFirst = prisma.clip.findFirst as unknown as jest.Mock;
    const ownedLookup = findFirst.getMockImplementation() as (
      args: unknown,
    ) => Promise<Record<string, unknown> | null>;
    findFirst.mockImplementation(async (args: unknown) => {
      const clip = await ownedLookup(args);
      return (
        clip && {
          ...clip,
          video: { transcript: { id: 'transcript-1', language: 'ar' } },
        }
      );
    });
    Object.assign(prisma, {
      transcriptSegment: {
        findMany: jest.fn().mockResolvedValue([
          {
            startSec: 99,
            endSec: 104,
            text: 'مرحبا بكم',
            words: [
              { word: 'مرحبا', startSec: 100.5, endSec: 100.9 },
              { word: 'بكم', startSec: 101, endSec: 101.4 },
            ],
          },
        ]),
      },
    });
  }

  it('requires a session', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/clips/clip-1/subtitles')
      .expect(401);
  });

  it('returns 404 for a clip that does not exist', async () => {
    const cookies = await registerAndLogin('owner@example.com');

    await request(app.getHttpServer())
      .get('/api/v1/clips/missing/subtitles')
      .set('Cookie', cookies)
      .expect(404);
  });

  it("returns 404 for another user's clip", async () => {
    await registerAndLogin('owner@example.com');
    seedClip();
    seedTranscript();
    const other = await registerAndLogin('other@example.com');

    await request(app.getHttpServer())
      .get('/api/v1/clips/clip-1/subtitles')
      .set('Cookie', other)
      .expect(404);
  });

  it('returns 409 while the video has no transcript', async () => {
    const cookies = await registerAndLogin('owner@example.com');
    seedClip();

    await request(app.getHttpServer())
      .get('/api/v1/clips/clip-1/subtitles')
      .set('Cookie', cookies)
      .expect(409);
  });

  it('returns cues with times relative to the clip start', async () => {
    const cookies = await registerAndLogin('owner@example.com');
    seedClip();
    seedTranscript();

    const response = await request(app.getHttpServer())
      .get('/api/v1/clips/clip-1/subtitles')
      .set('Cookie', cookies)
      .expect(200);

    expect(response.body).toEqual({
      clipId: 'clip-1',
      language: 'ar',
      displayMode: 'PHRASE',
      startSec: 100,
      endSec: 110,
      durationSec: 10,
      timing: 'WORD',
      cues: [{ index: 1, startSec: 0.5, endSec: 1.4, text: 'مرحبا بكم' }],
    });
  });

  it('builds one cue per word when the word mode is requested', async () => {
    const cookies = await registerAndLogin('owner@example.com');
    seedClip();
    seedTranscript();

    const response = await request(app.getHttpServer())
      .get('/api/v1/clips/clip-1/subtitles')
      .query({ mode: 'WORD' })
      .set('Cookie', cookies)
      .expect(200);

    const body = response.body as {
      displayMode: string;
      cues: { text: string }[];
    };
    expect(body.displayMode).toBe('WORD');
    expect(body.cues.map((cue) => cue.text)).toEqual(['مرحبا', 'بكم']);
  });

  it('rejects an unknown subtitle mode', async () => {
    const cookies = await registerAndLogin('owner@example.com');
    seedClip();
    seedTranscript();

    await request(app.getHttpServer())
      .get('/api/v1/clips/clip-1/subtitles')
      .query({ mode: 'LETTER' })
      .set('Cookie', cookies)
      .expect(400);
  });
});
