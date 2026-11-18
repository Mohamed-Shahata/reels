import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url().default('http://localhost:4000/api/v1'),
});

const parsed = envSchema.safeParse({
  NEXT_PUBLIC_API_URL:
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1',
});

if (!parsed.success) {
  const lines = parsed.error.issues.map(
    (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
  );
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}

export const env = parsed.data;
