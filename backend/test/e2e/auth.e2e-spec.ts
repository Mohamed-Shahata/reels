import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import type { ErrorResponseBody } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createPrismaFake } from '../support/prisma-fake';

describe('POST /api/v1/auth/register (e2e)', () => {
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

  it('creates a user and never returns the password or its hash', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: '  User@Example.com ', password: 'secret-pass-1' })
      .expect(201);

    expect(response.body).toMatchObject({ email: 'user@example.com' });
    expect(response.body).not.toHaveProperty('password');
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('secret-pass-1');

    expect(prisma.store).toHaveLength(1);
    expect(prisma.store[0].passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(prisma.store[0].passwordHash).not.toContain('secret-pass-1');
  });

  it('rejects a duplicate email regardless of letter case', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'user@example.com', password: 'secret-pass-1' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'USER@example.com', password: 'another-pass-2' })
      .expect(409);

    expect((response.body as ErrorResponseBody).message).toBe(
      'Email is already registered',
    );
    expect(prisma.store).toHaveLength(1);
  });

  it.each([
    ['an invalid email', { email: 'nope', password: 'secret-pass-1' }, 'email'],
    ['a short password', { email: 'a@b.co', password: 'a1' }, 'password'],
    [
      'a password without a number',
      { email: 'a@b.co', password: 'only-letters-here' },
      'password',
    ],
    [
      'a password without a letter',
      { email: 'a@b.co', password: '1234567890' },
      'password',
    ],
    [
      'an unknown field',
      { email: 'a@b.co', password: 'secret-pass-1', role: 'admin' },
      'role',
    ],
  ])('returns a structured 400 for %s', async (_name, body, field) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(body)
      .expect(400);

    expect((response.body as ErrorResponseBody).details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
    expect(prisma.store).toHaveLength(0);
  });

  it('does not echo the submitted password in validation errors', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'a@b.co', password: 'short1' })
      .expect(400);

    expect(JSON.stringify(response.body)).not.toContain('short1');
  });
});

describe('POST /api/v1/auth/login (e2e)', () => {
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

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'user@example.com', password: 'secret-pass-1' })
      .expect(201);
  });

  afterEach(async () => {
    await app.close();
  });

  it('sets httpOnly cookies, stores a hashed refresh token and keeps tokens out of the body', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'USER@example.com', password: 'secret-pass-1' })
      .expect(200);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith('access_token='));
    const refresh = cookies.find((c) => c.startsWith('refresh_token='));

    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Lax/i);
    expect(access).toMatch(/Path=\/;/);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);

    expect(response.body).toMatchObject({ email: 'user@example.com' });
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(response.body)).not.toMatch(/token/i);

    expect(prisma.sessions).toHaveLength(1);
    const rawRefresh = decodeURIComponent(
      (refresh as string).split(';')[0].split('=')[1],
    );
    expect(rawRefresh.startsWith(`${prisma.sessions[0].id}.`)).toBe(true);
    expect(prisma.sessions[0].refreshTokenHash).not.toContain(rawRefresh);
    expect(prisma.sessions[0].refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns an identical generic 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'wrong-pass-1' })
      .expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'secret-pass-1' })
      .expect(401);

    const a = wrongPassword.body as ErrorResponseBody;
    const b = unknownEmail.body as ErrorResponseBody;

    expect(a.message).toBe('Invalid email or password');
    expect(b.message).toBe(a.message);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    expect(prisma.sessions).toHaveLength(0);
  });

  it('returns a structured 400 for invalid input', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nope', password: '' })
      .expect(400);

    expect((response.body as ErrorResponseBody).details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'password' }),
      ]),
    );
  });
});

describe('Session lifecycle (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: ReturnType<typeof createPrismaFake>;

  const cookieHeader = (setCookie: string[]): string =>
    setCookie.map((c) => c.split(';')[0]).join('; ');

  const cookieValue = (setCookie: string[], name: string): string =>
    setCookie
      .find((c) => c.startsWith(`${name}=`))
      ?.split(';')[0]
      .slice(name.length + 1) ?? '';

  const login = async (): Promise<string[]> => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'secret-pass-1' })
      .expect(200);
    return response.headers['set-cookie'] as unknown as string[];
  };

  beforeEach(async () => {
    prisma = createPrismaFake();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'user@example.com', password: 'secret-pass-1' })
      .expect(201);
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /auth/me returns the current user for a valid session', async () => {
    const cookies = await login();

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(response.body).toMatchObject({ email: 'user@example.com' });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('GET /auth/me returns 401 without or with a bad access token', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', 'access_token=not-a-jwt')
      .expect(401);
  });

  it('POST /auth/refresh rotates the refresh token and issues new cookies', async () => {
    const cookies = await login();
    const oldRefresh = cookieValue(cookies, 'refresh_token');
    const oldHash = prisma.sessions[0].refreshTokenHash;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies))
      .expect(204);

    const refreshed = response.headers['set-cookie'] as unknown as string[];

    expect(cookieValue(refreshed, 'refresh_token')).not.toBe(oldRefresh);
    expect(cookieValue(refreshed, 'access_token')).not.toBe('');
    expect(prisma.sessions).toHaveLength(1);
    expect(prisma.sessions[0].refreshTokenHash).not.toBe(oldHash);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookieHeader(refreshed))
      .expect(200);
  });

  it('invalidates the whole session when a rotated refresh token is reused', async () => {
    const first = await login();

    const second = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(first))
        .expect(204)
    ).headers['set-cookie'] as unknown as string[];

    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(first))
      .expect(401);

    expect((reuse.body as ErrorResponseBody).message).toBe(
      'Invalid or expired session',
    );
    expect(prisma.sessions).toHaveLength(0);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(second))
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookieHeader(second))
      .expect(401);
  });

  it('POST /auth/refresh returns 401 and clears cookies without a valid token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .expect(401);

    const cleared = response.headers['set-cookie'] as unknown as string[];

    expect(cleared.some((c) => c.startsWith('refresh_token=;'))).toBe(true);
    expect(cleared.some((c) => c.startsWith('access_token=;'))).toBe(true);
  });

  it('POST /auth/logout revokes the session and clears cookies', async () => {
    const cookies = await login();

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(cookies))
      .expect(204);

    const cleared = response.headers['set-cookie'] as unknown as string[];

    expect(cleared.some((c) => c.startsWith('refresh_token=;'))).toBe(true);
    expect(prisma.sessions).toHaveLength(0);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookieHeader(cookies))
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies))
      .expect(401);
  });

  it('POST /auth/logout is idempotent without a session', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(204);
  });

  it('logout only ends the session of the presented token', async () => {
    const a = await login();
    await login();
    expect(prisma.sessions).toHaveLength(2);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(a))
      .expect(204);

    expect(prisma.sessions).toHaveLength(1);
  });
});
