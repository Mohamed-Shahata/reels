'use client';

import { getApiErrorMessage } from '@/lib/api';
import { useAuth } from './auth-provider';
import Image from 'next/image';
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

const passwordRules = [
  {
    label: 'At least 8 characters',
    test: (value: string) => value.length >= 8,
  },
  {
    label: 'At least one letter',
    test: (value: string) => /[A-Za-z]/.test(value),
  },
  { label: 'At least one number', test: (value: string) => /\d/.test(value) },
  {
    label: 'At most 128 characters',
    test: (value: string) => value.length <= 128,
  },
];

const inputClass =
  'mt-1.5 h-11 w-full rounded-lg border bg-white px-3 text-[15px] text-[#172321] outline-none transition placeholder:text-[#9aa7a2] focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/20';

export function AuthForm({ mode }: { mode: Mode }) {
  const { login, register, status } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
        getApiErrorMessage(
          requestError,
          'We could not reach the service. Please try again.',
        ),
      );
    } finally {
      setPending(false);
    }
  }

  const isLogin = mode === 'login';
  const title = isLogin ? 'Welcome back' : 'Create your account';
  const alternatePath = isLogin ? '/register' : '/login';
  const alternateText = isLogin ? 'Create an account' : 'Sign in instead';
  const busy = pending || status === 'loading';

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f7f4]">
      <header className="flex h-14 items-center justify-between border-b border-[#e3e6e2] bg-white px-5 sm:px-8">
        <Link className="flex items-center gap-2.5" href="/">
          <Image
            alt=""
            className="h-8 w-8"
            height={32}
            priority
            src="/reelcast-logo.svg"
            width={32}
          />
          <span className="text-[15px] font-semibold text-[#172321]">
            Reelcast
          </span>
          <span className="rounded-full bg-[#e4f3ef] px-2 py-0.5 text-[11px] font-medium text-[#0f766e]">
            Studio
          </span>
        </Link>
        <Link
          className="text-sm font-medium text-[#0f766e] hover:underline"
          href={alternatePath}
        >
          {alternateText}
        </Link>
      </header>

      <main className="grid flex-1 lg:grid-cols-2">
        <section className="flex items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-[400px]">
            <div className="rounded-2xl border border-[#e3e6e2] bg-white p-7 shadow-[0_8px_30px_rgba(15,60,55,0.06)] sm:p-8">
              <div className="flex items-center gap-3">
                <Image
                  alt=""
                  className="h-10 w-10"
                  height={40}
                  src="/reelcast-logo.svg"
                  width={40}
                />
                <div>
                  <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[#0f766e]">
                    REELCAST
                  </p>
                  {isLogin ? (
                    <p className="flex items-center gap-1.5 font-mono text-[10px] text-[#5d6d68]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
                      AI Video Engine v2.4
                    </p>
                  ) : null}
                </div>
                {isLogin ? null : (
                  <span className="ml-auto flex items-center gap-1.5 rounded-full bg-[#e4f3ef] px-2.5 py-1 font-mono text-[10px] text-[#0f766e]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
                    AI Video Engine v2.4
                  </span>
                )}
              </div>

              <h1 className="mt-6 text-[26px] font-bold leading-tight text-[#172321]">
                {title}
              </h1>
              <p className="mt-1.5 text-sm text-[#5d6d68]">
                {isLogin
                  ? 'Sign in to continue to your workspace.'
                  : 'Use your email to start your workspace.'}
              </p>

              <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
                <label
                  className="block font-mono text-[11px] font-semibold tracking-[0.08em] text-[#263532]"
                  htmlFor="email"
                >
                  <span className="flex items-baseline justify-between">
                    EMAIL
                    <span className="font-sans text-[11px] font-normal tracking-normal text-[#7a8883]">
                      Work or personal
                    </span>
                  </span>
                  <input
                    autoComplete="email"
                    className={`${inputClass} ${error ? 'border-[#c44932]' : 'border-[#d5dcd8]'} font-sans text-[15px] font-normal tracking-normal`}
                    id="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                    type="email"
                    value={email}
                  />
                </label>

                <label
                  className="block font-mono text-[11px] font-semibold tracking-[0.08em] text-[#263532]"
                  htmlFor="password"
                >
                  PASSWORD
                  <span className="relative block">
                    <input
                      autoComplete={
                        isLogin ? 'current-password' : 'new-password'
                      }
                      className={`${inputClass} ${error ? 'border-[#c44932]' : 'border-[#d5dcd8]'} pr-11 font-sans text-[15px] font-normal tracking-normal`}
                      id="password"
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={
                        isLogin ? '••••••••••••' : 'Create a strong password'
                      }
                      required
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                    />
                    <button
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      aria-pressed={showPassword}
                      className="absolute right-2 top-1/2 mt-[3px] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#5d6d68] hover:bg-[#f0f3f1]"
                      onClick={() => setShowPassword((value) => !value)}
                      type="button"
                    >
                      <svg
                        aria-hidden="true"
                        fill="none"
                        height="18"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                        viewBox="0 0 24 24"
                        width="18"
                      >
                        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                        {showPassword ? null : <path d="M4 4l16 16" />}
                      </svg>
                    </button>
                  </span>
                </label>

                {isLogin ? null : (
                  <div className="rounded-lg border border-[#e3e6e2] bg-[#f7f7f4] p-3">
                    <p className="font-mono text-[10px] font-semibold tracking-[0.1em] text-[#5d6d68]">
                      PASSWORD REQUIREMENTS
                    </p>
                    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {passwordRules.map((rule) => {
                        const met = password.length > 0 && rule.test(password);
                        return (
                          <li
                            className={`flex items-center gap-1.5 text-[11px] ${met ? 'text-[#0f766e]' : 'text-[#5d6d68]'}`}
                            key={rule.label}
                          >
                            <span
                              aria-hidden="true"
                              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] text-white ${met ? 'bg-[#0f766e]' : 'bg-[#c9d1cd]'}`}
                            >
                              ✓
                            </span>
                            {rule.label}
                            <span className="sr-only">
                              {met ? ' (met)' : ' (not met)'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {isLogin ? null : (
                  <p className="text-[11px] leading-4 text-[#5d6d68]">
                    By creating an account, you agree to Reelcast&apos;s{' '}
                    <span className="underline">Terms of Service</span> and{' '}
                    <span className="underline">Privacy Policy</span>.
                  </p>
                )}

                {error ? (
                  <p
                    className="rounded-lg border-l-2 border-[#c44932] bg-[#fff2ef] px-3 py-2 text-sm text-[#8f2f1f]"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0f766e] px-4 text-sm font-semibold text-white transition hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]"
                  disabled={busy}
                  type="submit"
                >
                  {pending ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      />
                      Please wait
                    </>
                  ) : (
                    <>{isLogin ? 'Sign in' : 'Create account'} →</>
                  )}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-[#5d6d68]">
                {isLogin ? 'New here?' : 'Already have an account?'}{' '}
                <Link
                  className="font-semibold text-[#0f766e] hover:underline"
                  href={alternatePath}
                >
                  {alternateText}
                </Link>
              </p>
            </div>
            <p
              className="mt-5 flex items-center justify-center gap-1.5 text-center font-[family-name:var(--font-cairo)] text-xs text-[#5d6d68]"
              dir="rtl"
              lang="ar"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
              مصمم خصيصاً لصناع المحتوى والبودكاست في العالم العربي
            </p>
          </div>
        </section>

        <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#0f766e] via-[#0b5f58] to-[#063b37] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="flex items-center justify-between text-[11px]">
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 font-mono">
              <span className="mr-1.5 text-[#5eead4]">●</span>
              9:16 Auto-Reframer &amp; AI Subtitling
            </span>
            <span className="flex gap-3 font-mono text-[#99f6e4]">
              <span>● TikTok</span>
              <span>● Instagram Reels</span>
              <span>● YouTube Shorts</span>
            </span>
          </div>

          <div className="grid items-center gap-8 xl:grid-cols-[1fr_250px]">
            <div>
              <span className="rounded bg-white/10 px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.12em] text-[#99f6e4]">
                AI PODCAST TO REELS
              </span>
              <h2 className="mt-4 text-[34px] font-bold leading-[1.15]">
                Turn hours of podcast into viral vertical clips in minutes.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-[#ccfbf1]">
                Upload your full episode, let AI detect the most compelling
                highlights, generate accurate Arabic transcripts, and export
                styled 9:16 reels with punchy Cairo subtitles.
              </p>
              <div className="mt-6 grid max-w-md grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/15 bg-white/10 p-3">
                  <p className="text-xl font-bold">99.2%</p>
                  <p className="font-mono text-[10px] tracking-wide text-[#99f6e4]">
                    ARABIC SUBTITLE ACCURACY
                  </p>
                </div>
                <div className="rounded-lg border border-white/15 bg-white/10 p-3">
                  <p className="text-xl font-bold">4x Faster</p>
                  <p className="font-mono text-[10px] tracking-wide text-[#99f6e4]">
                    CONTENT REPURPOSING
                  </p>
                </div>
              </div>
            </div>

            <div className="mx-auto w-[250px] rounded-[28px] border-[6px] border-[#0a1f1d] bg-black shadow-2xl">
              <div className="relative aspect-[9/16] overflow-hidden rounded-[22px]">
                <Image
                  alt="Podcast host speaking into a microphone"
                  className="object-cover"
                  fill
                  sizes="250px"
                  src="/podcast-host.jpg"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70" />
                <div className="absolute inset-x-0 top-0 flex justify-between px-3 pt-3 font-mono text-[9px] text-white/90">
                  <span>EP. 42 CLIP</span>
                  <span>00:28 / 00:54</span>
                </div>
                <div className="absolute inset-x-3 top-[52%]">
                  <div
                    className="rounded-lg bg-[#0f766e]/95 px-3 py-2 text-center font-[family-name:var(--font-cairo)] text-[15px] font-black leading-snug text-[#fde68a]"
                    dir="rtl"
                    lang="ar"
                  >
                    « أهم قاعدة في نجاح البودكاست »
                  </div>
                  <p
                    className="mt-1.5 text-center font-[family-name:var(--font-cairo)] text-[13px] font-bold leading-snug text-white"
                    dir="rtl"
                    lang="ar"
                  >
                    هي الاستمرارية وصناعة محتوى يلامس الناس!
                  </p>
                  <p className="mt-2 rounded bg-black/50 px-2 py-1 text-center font-mono text-[8px] text-[#99f6e4]">
                    Cairo Black • Animated Subtitle Style
                  </p>
                </div>
                <div className="absolute inset-x-3 bottom-3">
                  <div className="h-0.5 rounded bg-white/30">
                    <div className="h-full w-1/2 rounded bg-[#2dd4bf]" />
                  </div>
                  <p
                    className="mt-2 text-right font-[family-name:var(--font-cairo)] text-[10px] text-white/90"
                    dir="rtl"
                    lang="ar"
                  >
                    بودكاست فنجان • حوار الأسبوع
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between font-mono text-[10px] text-[#99f6e4]">
            <span>
              Automatic speech recognition with right-to-left Arabic rendering
            </span>
            <span>● Cairo Font Engine Ready</span>
          </div>
        </aside>
      </main>
    </div>
  );
}
