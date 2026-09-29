import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsEmail, IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { Public } from '../../src/auth/public.decorator';
import { configureApp } from '../../src/app.setup';
import type { ErrorResponseBody } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/prisma/prisma.service';

class SampleDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

@Public()
@Controller('sample')
class SampleController {
  @Post()
  create(@Body() body: SampleDto): SampleDto {
    return body;
  }
}

describe('API foundations (e2e)', () => {
  let app: INestApplication<App>;
  const queryRaw = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [SampleController],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: queryRaw,
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        processingJob: { findMany: jest.fn().mockResolvedValue([]) },
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    queryRaw.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns ok when the database is reachable', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('GET /api/v1/health returns 503 when the database is down', async () => {
    queryRaw.mockRejectedValue(new Error('connection refused'));

    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);

    expect(response.body).toMatchObject({
      statusCode: 503,
      message: 'Database is unreachable',
    });
  });

  it('returns a structured 404 for unknown routes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/unknown')
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: '/api/v1/unknown',
    });
  });

  it('returns a structured 400 for invalid input', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/sample')
      .send({ email: 'not-an-email', password: 'short', extra: true })
      .expect(400);

    const body = response.body as ErrorResponseBody;

    expect(body.statusCode).toBe(400);
    expect(body.message).toBe('Validation failed');
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'password' }),
        expect.objectContaining({ field: 'extra' }),
      ]),
    );
  });

  it('accepts valid input', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/sample')
      .send({ email: 'user@example.com', password: 'long-enough-password' })
      .expect(201);
  });
});
