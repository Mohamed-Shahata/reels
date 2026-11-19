'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { getApiErrorMessage } from '@/lib/api';
import { useAuth } from './auth-provider';
import { useLanguage } from '@/lib/i18n/language-context';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CheckIcon, EyeIcon, EyeOffIcon, AlertCircleIcon } from '@/components/ui/icons';

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
  { key: 'auth.min8Chars', test: (val: string) => val.length >= 8 },
  { key: 'auth.atLeastOneLetter', test: (val: string) => /[A-Za-z]/.test(val) },
  { key: 'auth.atLeastOneNumber', test: (val: string) => /\d/.test(val) },
  { key: 'auth.max128Chars', test: (val: string) => val.length <= 128 },
];

export function AuthForm({ mode }: { mode: Mode }) {
  const { login, register, status } = useAuth();
  const { t } = useLanguage();
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

  const isLogin = mode === 'login';
  const alternatePath = isLogin ? '/register' : '/login';
  const alternateText = isLogin
    ? t('auth.createAccountBtn')
    : t('auth.signIn');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const schema = isLogin ? loginSchema : registerSchema;
    const result = schema.safeParse({ email, password });

    if (!result.success) {
      setError(
        result.error.issues[0]?.message ?? 'Check the details and try again.',
      );
      return;
    }

    setPending(true);
    try {
      if (isLogin) {
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

  const busy = pending || status === 'loading';

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between p-4 sm:p-6">
      {/* Top Bar with Language Switcher */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between py-2">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            alt="Reelcast"
            className="h-7 w-7"
            height={28}
            priority
            src="/reelcast-logo.svg"
            width={28}
          />
          <span className="font-bold text-base tracking-tight text-foreground">
            Reelcast
          </span>
          <Badge variant="accent" size="sm">
            Studio
          </Badge>
        </Link>
        <LanguageSwitcher />
      </header>

      {/* Main Centered Card */}
      <main className="w-full flex-1 flex items-center justify-center py-8">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm space-y-6">
          <div className="space-y-1.5 text-center sm:text-start">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {isLogin ? t('auth.welcomeBack') : t('auth.createAccount')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isLogin
                ? t('auth.signInSubtitle')
                : t('auth.registerSubtitle')}
            </p>
          </div>

          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            {/* Email Field */}
            <div className="space-y-1.5">
              <label
                className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block"
                htmlFor="email"
              >
                {t('auth.email')}
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-10 text-sm"
              />
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label
                className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block"
                htmlFor="password"
              >
                {t('auth.password')}
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isLogin ? '••••••••••••' : '••••••••••••'}
                  required
                  className="h-10 pe-10 text-sm"
                />
                <button
                  type="button"
                  aria-label={
                    showPassword
                      ? t('auth.hidePassword')
                      : t('auth.showPassword')
                  }
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOffIcon className="w-4 h-4" />
                  ) : (
                    <EyeIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Register: Password Rules */}
            {!isLogin && (
              <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase block">
                  {t('auth.passwordRequirements')}
                </span>
                <ul className="grid grid-cols-2 gap-1.5 text-xs">
                  {passwordRules.map((rule) => {
                    const met = password.length > 0 && rule.test(password);
                    return (
                      <li
                        key={rule.key}
                        className={`flex items-center gap-1.5 text-[11px] ${
                          met ? 'text-primary' : 'text-muted-foreground'
                        }`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 text-[9px] ${
                            met
                              ? 'bg-primary text-primary-foreground'
                              : 'border border-border bg-muted/40 text-transparent'
                          }`}
                        >
                          <CheckIcon className="w-2.5 h-2.5" />
                        </span>
                        <span>{t(rule.key)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Error Banner */}
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
              >
                <AlertCircleIcon className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={busy}
              isLoading={pending}
              className="w-full h-10 font-semibold"
            >
              {isLogin ? t('auth.signIn') : t('auth.createAccountBtn')}
            </Button>
          </form>

          {/* Alternate Link */}
          <div className="pt-2 text-center text-sm text-muted-foreground">
            <span>
              {isLogin ? t('auth.newHere') : t('auth.alreadyHaveAccount')}{' '}
            </span>
            <Link
              href={alternatePath}
              className="font-semibold text-primary hover:underline ms-1"
            >
              {alternateText}
            </Link>
          </div>
        </div>
      </main>

      {/* Footer Branding Note */}
      <footer className="text-center py-2 text-xs text-muted-foreground">
        <span>{t('auth.arabicCreatorPitch')}</span>
      </footer>
    </div>
  );
}
