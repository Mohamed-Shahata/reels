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
    RABBITMQ_URL: nonEmpty
      .refine(
        (value) => /^amqp(s)?:\/\//.test(value),
        'must be an AMQP connection string',
      )
      .default('amqp://guest:guest@localhost:5672'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: nonEmpty.default('us-east-1'),
    S3_BUCKET: nonEmpty.default('reels-media'),
    S3_ACCESS_KEY_ID: nonEmpty.default('minioadmin'),
    S3_SECRET_ACCESS_KEY: nonEmpty.default('minioadmin'),
    S3_FORCE_PATH_STYLE: z
      .preprocess((val) => {
        if (val === undefined || val === '') return true;
        if (typeof val === 'string') {
          return val.toLowerCase() !== 'false' && val !== '0';
        }
        return Boolean(val);
      }, z.boolean())
      .default(true),
    DOWNLOAD_URL_TTL_SEC: z.coerce.number().int().positive().default(300),
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
    GROQ_API_KEY: nonEmpty,
    TRANSCRIBE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    ANALYZER_URL: z.string().url().default('http://localhost:8001'),
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
    WORKER_CONCURRENCY_RENDER: z.coerce.number().int().min(1).default(1),
    RENDER_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
    VIDEO_ALLOWED_FORMATS: nonEmpty
      .default('mp4,mov,webm,mkv')
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
    CLIP_MAX_DURATION_SEC: z.coerce.number().positive().default(240),
    AI_CLIP_MIN_DURATION_SEC: z.coerce.number().positive().default(20),
    AI_CLIP_MAX_DURATION_SEC: z.coerce.number().positive().default(90),
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
  })
  .refine(
    (env) => env.AI_CLIP_MAX_DURATION_SEC >= env.AI_CLIP_MIN_DURATION_SEC,
    {
      path: ['AI_CLIP_MAX_DURATION_SEC'],
      message: 'must be greater than or equal to AI_CLIP_MIN_DURATION_SEC',
    },
  );

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
