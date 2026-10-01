'use client';

import { useAuth } from '@/components/auth/auth-provider';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AppHeader({ active = 'Workspace' }: { active?: string }) {
  const { logout, user } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    router.replace('/login');
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#e2eae6] bg-white/85 px-5 backdrop-blur sm:px-8">
      <div className="flex items-center gap-6">
        <Link className="flex items-center gap-2.5" href="/">
          <Image
            alt=""
            className="h-8 w-8"
            height={32}
            priority
            src="/reelcast-logo.svg"
            width={32}
          />
          <span className="text-base font-bold tracking-tight">Reelcast</span>
          <span className="rounded-full bg-[#e4f3ef] px-2 py-0.5 text-[11px] font-medium text-[#0f766e]">
            Studio
          </span>
        </Link>
        <Link
          className="border-b-2 border-[#0f766e] py-[15px] text-sm font-bold text-[#0f766e]"
          href="/"
        >
          {active}
        </Link>
      </div>
      <div className="flex items-center gap-3">
        {user ? (
          <>
            <span className="hidden text-xs text-[#5d6d68] sm:inline">
              {user.email}
            </span>
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0f766e] text-xs font-bold uppercase text-white ring-2 ring-[#e4f3ef]"
            >
              {user.email.charAt(0)}
            </span>
          </>
        ) : null}
        <button
          className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-[#263532] hover:bg-[#f2f6f4] hover:text-[#0f766e] disabled:opacity-50"
          disabled={loggingOut}
          onClick={() => void handleLogout()}
          type="button"
        >
          {loggingOut ? 'Signing out' : 'Sign out'}
        </button>
      </div>
    </header>
  );
}
