import { z } from 'zod';
import { env } from './env';

const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
});

const errorSchema = z.object({
  message: z.union([z.string(), z.array(z.string())]).optional(),
});

export type User = z.infer<typeof userSchema>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const result = errorSchema.safeParse(body);
    const message = result.success
      ? Array.isArray(result.data.message)
        ? result.data.message[0]
        : result.data.message
      : undefined;

    throw new ApiError(
      message ?? 'Something went wrong. Please try again.',
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return schema.parse(await response.json());
}

export const api = {
  getCurrentUser: () => request('/auth/me', userSchema),
  refresh: () => request('/auth/refresh', z.undefined(), { method: 'POST' }),
  login: (email: string, password: string) =>
    request('/auth/login', userSchema, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string) =>
    request('/auth/register', userSchema, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request('/auth/logout', z.undefined(), { method: 'POST' }),
};
