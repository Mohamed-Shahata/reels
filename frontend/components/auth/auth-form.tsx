'use client';

import { ApiError } from '@/lib/api';
import { useAuth } from './auth-provider';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

const registerSchema = loginSchema.extend({
  password: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(128, 'Use 128 characters or fewer.')
    .regex(/[A-Za-z]/, 'Include at least one letter.')
    .regex(/\d/, 'Include at least one number.'),
});

type Mode = 'login' | 'register';

export function AuthForm({ mode }: { mode: Mode }) {
  const { login, register, status } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
    }
  }, [router, status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const schema = mode === 'login' ? loginSchema : registerSchema;
    const result = schema.safeParse({ email, password });

    if (!result.success) {
      setError(
        result.error.issues[0]?.message ?? 'Check the details and try again.',
      );
      return;
    }

    setPending(true);
    try {
      if (mode === 'login') {
        await login(result.data.email, result.data.password);
      } else {
        await register(result.data.email, result.data.password);
      }
      router.replace('/');
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We could not reach the service. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  const isLogin = mode === 'login';
  const title = isLogin ? 'Welcome back' : 'Create your account';
  const alternatePath = isLogin ? '/register' : '/login';
  const alternateText = isLogin ? 'Create an account' : 'Sign in instead';

  return (
    <main className="grid min-h-screen bg-[#f6f8f7] lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
      <section className="relative hidden overflow-hidden bg-[#123b3a] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="text-sm font-semibold tracking-[0.18em] text-[#a7d8c8]">
          PODCAST REELS
        </div>
        <div className="max-w-md">
          <p className="text-4xl font-semibold leading-tight">
            Turn the moments worth sharing into reels.
          </p>
        </div>
        <div className="relative h-64 overflow-hidden border border-white/20 bg-[#0d2f2e] p-5">
          <div className="h-36 w-28 bg-[#d9684b]" />
          <div className="absolute left-40 top-8 h-28 w-44 border border-white/30 bg-[#1d5451]" />
          <div className="absolute bottom-7 left-5 right-5 flex h-12 items-end gap-1 border-t border-white/25 pt-3">
            {[
              18, 32, 24, 44, 29, 38, 21, 47, 35, 26, 42, 30, 45, 24, 37, 20,
            ].map((height, index) => (
              <span
                className="flex-1 bg-[#a7d8c8]"
                key={`${height}-${index}`}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <Link
            className="text-sm font-semibold tracking-[0.16em] text-[#123b3a] lg:hidden"
            href="/"
          >
            PODCAST REELS
          </Link>
          <div className="mt-12">
            <h1 className="text-3xl font-semibold text-[#172321]">{title}</h1>
            <p className="mt-3 text-sm leading-6 text-[#5f6e69]">
              {isLogin
                ? 'Sign in to continue to your workspace.'
                : 'Use your email to start your workspace.'}
            </p>
          </div>

          <form className="mt-8 space-y-5" onSubmit={onSubmit} noValidate>
            <label
              className="block text-sm font-medium text-[#263532]"
              htmlFor="email"
            >
              Email address
              <input
                autoComplete="email"
                className="mt-2 h-11 w-full border border-[#bcc8c2] bg-white px-3 text-base text-[#172321] outline-none transition focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/20"
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>

            <label
              className="block text-sm font-medium text-[#263532]"
              htmlFor="password"
            >
              Password
              <input
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                className="mt-2 h-11 w-full border border-[#bcc8c2] bg-white px-3 text-base text-[#172321] outline-none transition focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/20"
                id="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>

            {error ? (
              <p
                className="border-l-2 border-[#c44932] bg-[#fff2ef] px-3 py-2 text-sm text-[#8f2f1f]"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <button
              className="h-11 w-full bg-[#0f766e] px-4 text-sm font-semibold text-white transition hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
              disabled={pending || status === 'loading'}
              type="submit"
            >
              {pending ? 'Please wait' : isLogin ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#5f6e69]">
            {isLogin ? 'New here?' : 'Already have an account?'}{' '}
            <Link
              className="font-semibold text-[#0f766e] underline underline-offset-4"
              href={alternatePath}
            >
              {alternateText}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
