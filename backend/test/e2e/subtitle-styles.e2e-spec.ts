import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createPrismaFake } from '../support/prisma-fake';

describe('subtitle styles (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createPrismaFake())
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  async function registerAndLogin(): Promise<string> {
    const email = 'styles@example.com';
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

  describe('GET /api/v1/subtitles/styles', () => {
    it('requires a session', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/subtitles/styles')
        .expect(401);
    });

    it('returns at least three presets with the available choices', async () => {
      const cookies = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .get('/api/v1/subtitles/styles')
        .set('Cookie', cookies)
        .expect(200);

      const body = response.body as {
        defaultPresetId: string;
        fonts: string[];
        positions: string[];
        fontSize: { min: number; max: number };
        presets: { id: string; style: Record<string, unknown> }[];
      };
      expect(body.presets.length).toBeGreaterThanOrEqual(3);
      expect(body.presets.map((preset) => preset.id)).toContain(
        body.defaultPresetId,
      );
      expect(body.fonts).toEqual(['Cairo', 'Amiri', 'Arial']);
      expect(body.positions).toEqual(['TOP', 'MIDDLE', 'BOTTOM']);
      expect((body as { displayModes?: string[] }).displayModes).toEqual([
        'PHRASE',
        'WORD',
      ]);
      expect(body.fontSize).toEqual({ min: 20, max: 72 });
    });
  });

  describe('GET /api/v1/subtitles/styles/resolve', () => {
    it('requires a session', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/subtitles/styles/resolve')
        .expect(401);
    });

    it('returns the default preset when no query is given', async () => {
      const cookies = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .get('/api/v1/subtitles/styles/resolve')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toMatchObject({
        presetId: 'REEL',
        style: {
          fontFamily: 'Cairo',
          position: 'MIDDLE',
          displayMode: 'PHRASE',
        },
      });
    });

    it('applies overrides on top of the chosen preset', async () => {
      const cookies = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .get('/api/v1/subtitles/styles/resolve')
        .query({
          preset: 'MINIMAL',
          fontFamily: 'Amiri',
          fontSizePx: '48',
          bold: 'true',
          textColor: '#FACC15',
          backgroundOpacity: '0.4',
          position: 'MIDDLE',
        })
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toEqual({
        presetId: 'MINIMAL',
        style: {
          fontFamily: 'Amiri',
          fontSizePx: 48,
          bold: true,
          textColor: '#facc15',
          backgroundColor: '#000000',
          backgroundOpacity: 0.4,
          position: 'MIDDLE',
          displayMode: 'PHRASE',
        },
      });
    });

    it('lets the caller switch to word by word subtitles', async () => {
      const cookies = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .get('/api/v1/subtitles/styles/resolve')
        .query({ displayMode: 'WORD' })
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toMatchObject({
        style: { displayMode: 'WORD' },
      });
    });

    it('rejects an unknown display mode', async () => {
      const cookies = await registerAndLogin();

      await request(app.getHttpServer())
        .get('/api/v1/subtitles/styles/resolve')
        .query({ displayMode: 'LETTER' })
        .set('Cookie', cookies)
        .expect(400);
    });

    it.each([
      ['an unknown preset', { preset: 'NEON' }],
      ['an unsupported font', { fontFamily: 'Tahoma' }],
      ['a font size below the minimum', { fontSizePx: '10' }],
      ['a font size above the maximum', { fontSizePx: '200' }],
      ['a fractional font size', { fontSizePx: '30.5' }],
      ['a color that is not a hex value', { textColor: 'red' }],
      ['a short hex color', { backgroundColor: '#fff' }],
      ['an opacity above one', { backgroundOpacity: '1.5' }],
      ['a negative opacity', { backgroundOpacity: '-0.1' }],
      ['an unknown position', { position: 'LEFT' }],
      ['a non boolean bold value', { bold: 'maybe' }],
      ['an unknown query field', { shadow: 'true' }],
    ])('rejects %s with 400', async (_name, query) => {
      const cookies = await registerAndLogin();

      await request(app.getHttpServer())
        .get('/api/v1/subtitles/styles/resolve')
        .query(query)
        .set('Cookie', cookies)
        .expect(400);
    });
  });
});
