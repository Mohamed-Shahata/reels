import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: nonEmpty.refine(
    (value) => /^postgres(ql)?:\/\//.test(value),
    'must be a PostgreSQL connection string',
  ),
  CORS_ORIGIN: nonEmpty.transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().min(3600).default(2592000),
  AUTH_RATE_LIMIT_TTL_SEC: z.coerce.number().int().min(1).default(60),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  CLOUDINARY_CLOUD_NAME: nonEmpty,
  CLOUDINARY_API_KEY: nonEmpty,
  CLOUDINARY_API_SECRET: nonEmpty,
  CLOUDINARY_UPLOAD_PRESET: nonEmpty.optional(),
  CLOUDINARY_UPLOAD_FOLDER: nonEmpty.default('podcast-reels'),
  VIDEO_ALLOWED_FORMATS: nonEmpty
    .default('mp4,mov,webm')
    .transform((value) =>
      value
        .split(',')
        .map((format) => format.trim().toLowerCase())
        .filter(Boolean),
    )
    .refine(
      (formats) => formats.length > 0,
      'must include at least one format',
    ),
  VIDEO_MAX_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024 * 1024),
  VIDEO_MAX_DURATION_SEC: z.coerce
    .number()
    .positive()
    .default(4 * 60 * 60),
  STALE_UPLOAD_THRESHOLD_SEC: z.coerce.number().int().min(60).default(86400),
  STALE_UPLOAD_CLEANUP_INTERVAL_SEC: z.coerce
    .number()
    .int()
    .min(60)
    .default(3600),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  return result.data;
}
