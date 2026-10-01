import { validateEnv } from '../../../src/config/env.schema';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGIN: 'http://localhost:3000, https://app.example.com',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  CLOUDINARY_CLOUD_NAME: 'cloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
  GROQ_API_KEY: 'gsk_test_key',
};

describe('validateEnv', () => {
  it('applies defaults and transforms values', () => {
    const env = validateEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.COOKIE_SAME_SITE).toBe('lax');
    expect(env.ACCESS_TOKEN_TTL_SEC).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_SEC).toBe(2592000);
    expect(env.AUTH_RATE_LIMIT_TTL_SEC).toBe(60);
    expect(env.AUTH_RATE_LIMIT_MAX).toBe(10);
    expect(env.CLOUDINARY_UPLOAD_FOLDER).toBe('podcast-reels');
    expect(env.GROQ_SEGMENTATION_MODEL).toBe('openai/gpt-oss-20b');
    expect(env.SEGMENTATION_WINDOW_MAX_CHARS).toBe(6000);
    expect(env.SEGMENTATION_WINDOW_OVERLAP_SEC).toBe(30);
    expect(env.SEGMENTATION_MAX_COMPLETION_TOKENS).toBe(3000);
    expect(env.SEGMENTATION_CONCURRENCY).toBe(1);
    expect(env.SEGMENTATION_VALIDATION_MAX_ATTEMPTS).toBe(3);
    expect(env.SEGMENTATION_MONTHLY_RUN_LIMIT).toBe(20);
    expect(env.RENDER_POLL_INTERVAL_MS).toBe(3000);
    expect(env.RENDER_TIMEOUT_MS).toBe(300000);
    expect(env.VIDEO_ALLOWED_FORMATS).toEqual(['mp4', 'mov', 'webm']);
    expect(env.VIDEO_MAX_SIZE_BYTES).toBe(5 * 1024 * 1024 * 1024);
    expect(env.VIDEO_MAX_DURATION_SEC).toBe(4 * 60 * 60);
    expect(env.CLIP_MIN_DURATION_SEC).toBe(5);
    expect(env.CLIP_MAX_DURATION_SEC).toBe(240);
    expect(env.AI_CLIP_MIN_DURATION_SEC).toBe(60);
    expect(env.AI_CLIP_MAX_DURATION_SEC).toBe(240);
    expect(env.STALE_UPLOAD_THRESHOLD_SEC).toBe(86400);
    expect(env.STALE_UPLOAD_CLEANUP_INTERVAL_SEC).toBe(3600);
    expect(env.CORS_ORIGIN).toEqual([
      'http://localhost:3000',
      'https://app.example.com',
    ]);
  });

  it('coerces PORT to a number', () => {
    expect(validateEnv({ ...validEnv, PORT: '5001' }).PORT).toBe(5001);
  });

  it('rejects missing required variables and lists them', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({})).toThrow(/CLOUDINARY_API_SECRET/);
  });

  it('rejects an invalid database url', () => {
    expect(() =>
      validateEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects an out of range port', () => {
    expect(() => validateEnv({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects a short jwt secret', () => {
    expect(() =>
      validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'short' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a non-positive rate limit', () => {
    expect(() =>
      validateEnv({ ...validEnv, AUTH_RATE_LIMIT_MAX: '0' }),
    ).toThrow(/AUTH_RATE_LIMIT_MAX/);
  });

  it('accepts a cross-site cookie setting for separately hosted staging apps', () => {
    expect(
      validateEnv({ ...validEnv, COOKIE_SAME_SITE: 'none' }).COOKIE_SAME_SITE,
    ).toBe('none');
  });

  it('normalizes configured video formats and rejects invalid limits', () => {
    expect(
      validateEnv({ ...validEnv, VIDEO_ALLOWED_FORMATS: 'MP4, webm ' })
        .VIDEO_ALLOWED_FORMATS,
    ).toEqual(['mp4', 'webm']);
    expect(() =>
      validateEnv({ ...validEnv, VIDEO_MAX_SIZE_BYTES: '0' }),
    ).toThrow(/VIDEO_MAX_SIZE_BYTES/);
    expect(() =>
      validateEnv({ ...validEnv, VIDEO_MAX_DURATION_SEC: '0' }),
    ).toThrow(/VIDEO_MAX_DURATION_SEC/);
    expect(() =>
      validateEnv({ ...validEnv, SEGMENTATION_WINDOW_MAX_CHARS: '999' }),
    ).toThrow(/SEGMENTATION_WINDOW_MAX_CHARS/);
    expect(() =>
      validateEnv({ ...validEnv, SEGMENTATION_VALIDATION_MAX_ATTEMPTS: '0' }),
    ).toThrow(/SEGMENTATION_VALIDATION_MAX_ATTEMPTS/);
    expect(() =>
      validateEnv({ ...validEnv, SEGMENTATION_MONTHLY_RUN_LIMIT: '0' }),
    ).toThrow(/SEGMENTATION_MONTHLY_RUN_LIMIT/);
    expect(() =>
      validateEnv({
        ...validEnv,
        CLIP_MIN_DURATION_SEC: '181',
        CLIP_MAX_DURATION_SEC: '180',
      }),
    ).toThrow(/CLIP_MAX_DURATION_SEC/);
    expect(() =>
      validateEnv({ ...validEnv, STALE_UPLOAD_THRESHOLD_SEC: '59' }),
    ).toThrow(/STALE_UPLOAD_THRESHOLD_SEC/);
  });
});
