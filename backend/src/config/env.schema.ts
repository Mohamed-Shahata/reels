import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: nonEmpty.refine(
      (value) => /^postgres(ql)?:\/\//.test(value),
      'must be a PostgreSQL connection string',
    ),
    REDIS_URL: nonEmpty.refine(
      (value) => /^redis(s)?:\/\//.test(value),
      'must be a Redis connection string',
    ),
    CORS_ORIGIN: nonEmpty.transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    COOKIE_SAME_SITE: z.enum(['lax', 'none', 'strict']).default('lax'),
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
    GROQ_API_KEY: nonEmpty,
    GROQ_SEGMENTATION_MODEL: nonEmpty.default('openai/gpt-oss-20b'),
    SEGMENTATION_WINDOW_MAX_CHARS: z.coerce
      .number()
      .int()
      .min(1000)
      .default(6000),
    SEGMENTATION_WINDOW_OVERLAP_SEC: z.coerce.number().min(0).default(30),
    SEGMENTATION_MAX_COMPLETION_TOKENS: z.coerce
      .number()
      .int()
      .min(1024)
      .default(3000),
    SEGMENTATION_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
    SEGMENTATION_VALIDATION_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .default(3),
    SEGMENTATION_MONTHLY_RUN_LIMIT: z.coerce.number().int().min(1).default(20),
    RENDER_POLL_INTERVAL_MS: z.coerce.number().int().min(1).default(3000),
    RENDER_TIMEOUT_MS: z.coerce.number().int().min(1).default(300000),
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
    CLIP_MIN_DURATION_SEC: z.coerce.number().positive().default(5),
    CLIP_MAX_DURATION_SEC: z.coerce.number().positive().default(180),
    STALE_UPLOAD_THRESHOLD_SEC: z.coerce.number().int().min(60).default(86400),
    STALE_UPLOAD_CLEANUP_INTERVAL_SEC: z.coerce
      .number()
      .int()
      .min(60)
      .default(3600),
  })
  .refine((env) => env.CLIP_MAX_DURATION_SEC >= env.CLIP_MIN_DURATION_SEC, {
    path: ['CLIP_MAX_DURATION_SEC'],
    message: 'must be greater than or equal to CLIP_MIN_DURATION_SEC',
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
