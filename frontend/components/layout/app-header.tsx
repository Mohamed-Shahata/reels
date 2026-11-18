'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { useLanguage } from '@/lib/i18n/language-context';
import { api, type Usage } from '@/lib/api';

export function AppHeader() {
  const { logout, user } = useAuth();
  const router = useRouter();
  const { t, language } = useLanguage();
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [usage, setUsage] = React.useState<Usage | null>(null);

  React.useEffect(() => {
    let mounted = true;
    if (user) {
      api.getUsage()
        .then((res) => {
          if (mounted) setUsage(res);
        })
        .catch(() => {
          // Non-blocking usage fetch error
        });
    }
    return () => {
      mounted = false;
    };
  }, [user]);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    router.replace('/login');
  }

  const minutesLabel = language === 'ar' ? 'دقيقة' : 'min';

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg/85 px-4 sm:px-8 backdrop-blur-md text-text">
      {/* Brand Logo */}
      <div className="flex items-center gap-3">
        <Link className="flex items-center gap-2.5 group" href="/">
          <Image
            alt="ReelCast Logo"
            className="h-8 w-8 transition-transform group-hover:scale-105"
            height={32}
            priority
            src="/reelcast-logo.svg"
            width={32}
          />
          <span className="text-base font-bold tracking-tight text-text">
            {t('header.brandName')}
          </span>
          <span className="rounded-full bg-accent-soft text-accent border border-accent/20 px-2 py-0.5 text-[11px] font-semibold">
            {t('header.studio')}
          </span>
        </Link>
      </div>

      {/* Actions & Profile */}
      <div className="flex items-center gap-2.5 sm:gap-4">
        {/* Language Switcher */}
        <LanguageSwitcher />

        {/* Usage Chip */}
        {user && usage && (
          <div
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-2 border border-border text-xs text-muted"
            title={`${usage.uploadedMinutes} / 60 ${minutesLabel}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span className="font-medium text-text">
              {Math.round(usage.uploadedMinutes)} / 60
            </span>
            <span>{minutesLabel}</span>
          </div>
        )}

        {/* User Avatar & Logout */}
        {user ? (
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-on-accent text-xs font-bold uppercase shadow-xs ring-1 ring-border"
              title={user.email}
            >
              {user.email.charAt(0)}
            </span>
            <button
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted hover:text-text hover:bg-surface-2 transition-colors disabled:opacity-50"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
              type="button"
            >
              {loggingOut ? t('header.signingOut') : t('header.signOut')}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
