import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { Public } from '../../src/auth/public.decorator';
import { configureApp } from '../../src/app.setup';
import type { ErrorResponseBody } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createPrismaFake } from '../support/prisma-fake';

@Controller('probe')
class ProbeController {
  @Get('protected')
  protectedRoute(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Get('open')
  openRoute(): { ok: true } {
    return { ok: true };
  }
}

describe('Global auth guard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: ReturnType<typeof createPrismaFake>;

  beforeEach(async () => {
    prisma = createPrismaFake();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
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

  it('returns 401 on a protected route without a session', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/protected')
      .expect(401);

    expect((response.body as ErrorResponseBody).statusCode).toBe(401);
  });

  it('returns 401 on a protected route with an invalid access token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/probe/protected')
      .set('Cookie', 'access_token=garbage')
      .expect(401);
  });

  it('allows a protected route with a valid session and blocks it after logout', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'user@example.com', password: 'secret-pass-1' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'secret-pass-1' })
      .expect(200);
    const cookies = (login.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');

    await request(app.getHttpServer())
      .get('/api/v1/probe/protected')
      .set('Cookie', cookies)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies)
      .expect(204);

    await request(app.getHttpServer())
      .get('/api/v1/probe/protected')
      .set('Cookie', cookies)
      .expect(401);
  });

  it('keeps @Public routes, health and the auth entry points open', async () => {
    await request(app.getHttpServer()).get('/api/v1/probe/open').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'x' })
      .expect(401);
  });

  it('still returns 404 for unknown routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
  });
});
