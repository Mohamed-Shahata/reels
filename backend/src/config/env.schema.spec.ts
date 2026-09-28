import { validateEnv } from './env.schema';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  CORS_ORIGIN: 'http://localhost:3000, https://app.example.com',
  CLOUDINARY_CLOUD_NAME: 'cloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
};

describe('validateEnv', () => {
  it('applies defaults and transforms values', () => {
    const env = validateEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.CLOUDINARY_UPLOAD_FOLDER).toBe('podcast-reels');
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
});
