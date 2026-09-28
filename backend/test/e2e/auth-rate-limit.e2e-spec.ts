import { INestApplication } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import type { ErrorResponseBody } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createPrismaFake } from '../support/prisma-fake';

const LIMIT = 3;

describe('Auth rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createPrismaFake())
      .overrideProvider(getOptionsToken())
      .useValue({
        errorMessage: 'Too many requests, please try again later',
        throttlers: [{ ttl: 60_000, limit: LIMIT }],
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const attemptLogin = () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'wrong-pass-1' });

  it('returns 429 with a structured body once the limit is exceeded', async () => {
    for (let i = 0; i < LIMIT; i++) {
      await attemptLogin().expect(401);
    }

    const response = await attemptLogin().expect(429);

    expect(response.body).toMatchObject({
      statusCode: 429,
      message: 'Too many requests, please try again later',
    });
    expect((response.body as ErrorResponseBody).path).toBe(
      '/api/v1/auth/login',
    );
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('limits each credential route independently per client', async () => {
    for (let i = 0; i < LIMIT; i++) {
      await attemptLogin().expect(401);
    }

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'new@example.com', password: 'secret-pass-1' })
      .expect(201);
  });

  it('does not rate limit GET /auth/me or the health check', async () => {
    for (let i = 0; i < LIMIT + 2; i++) {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    }
  });
});
