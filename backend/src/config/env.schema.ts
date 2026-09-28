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
  CLOUDINARY_CLOUD_NAME: nonEmpty,
  CLOUDINARY_API_KEY: nonEmpty,
  CLOUDINARY_API_SECRET: nonEmpty,
  CLOUDINARY_UPLOAD_PRESET: nonEmpty.optional(),
  CLOUDINARY_UPLOAD_FOLDER: nonEmpty.default('podcast-reels'),
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
