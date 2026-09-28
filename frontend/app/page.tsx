'use client';

import { useAuth } from '@/components/auth/auth-provider';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Home() {
  const { logout, status, user } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [router, status]);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    router.replace('/login');
  }

  if (status !== 'authenticated' || !user) {
    return <main className="min-h-screen bg-[#f6f8f7]" />;
  }

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-[#172321]">
      <header className="flex min-h-16 items-center justify-between border-b border-[#d8e1dc] bg-white px-5 sm:px-8">
        <span className="text-sm font-semibold tracking-[0.16em] text-[#123b3a]">
          PODCAST REELS
        </span>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-[#5f6e69] sm:inline">
            {user.email}
          </span>
          <button
            className="h-9 border border-[#a9bab3] px-3 text-sm font-medium text-[#263532] transition hover:border-[#0f766e] hover:text-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loggingOut}
            onClick={() => void handleLogout()}
            type="button"
          >
            {loggingOut ? 'Signing out' : 'Sign out'}
          </button>
        </div>
      </header>
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center px-5 py-12 sm:px-8">
        <div className="w-full">
          <p className="text-sm font-medium text-[#0f766e]">Workspace</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="text-3xl font-semibold sm:text-4xl">
                Your videos
              </h1>
              <p className="mt-3 text-base text-[#5f6e69]">
                Upload a podcast to start creating clips.
              </p>
            </div>
            <Link
              className="inline-flex h-11 items-center bg-[#0f766e] px-5 text-sm font-semibold text-white transition hover:bg-[#0b615b]"
              href="/videos/new"
            >
              Upload video
            </Link>
          </div>
          <div className="mt-12 border-y border-[#d8e1dc] py-10 text-sm text-[#5f6e69]">
            No videos uploaded yet.
          </div>
        </div>
      </section>
    </main>
  );
}
