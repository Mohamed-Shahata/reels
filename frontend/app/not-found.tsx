import { CopyUrlButton } from '@/components/common/copy-url-button';
import { RequestedPath } from '@/components/common/requested-path';
import { AppFooter } from '@/components/layout/app-footer';
import { AppHeader } from '@/components/layout/app-header';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found · Reelcast Studio',
};

const WAVE = [14, 26, 40, 56, 34, 20, 10];
const WAVE_LOST = [16, 28, 12];

function Bars({
  heights,
  muted = false,
}: {
  heights: number[];
  muted?: boolean;
}) {
  return (
    <span aria-hidden="true" className="flex h-16 items-center gap-1.5">
      {heights.map((height, index) => (
        <span
          className={`w-1.5 rounded-full ${muted ? 'bg-[#3d5c55]' : 'bg-[#7fe3d3]'}`}
          key={index}
          style={{ height }}
        />
      ))}
    </span>
  );
}

export default function NotFound() {
  return (
    <>
      <AppHeader />
      <main className="flex flex-1 items-center justify-center bg-[#eefaf5] px-4 py-10 sm:py-14">
        <section className="w-full max-w-3xl rounded-2xl bg-white px-5 py-8 text-center shadow-[0_8px_30px_rgba(15,118,110,0.08)] sm:px-10 sm:py-10">
          <p className="mx-auto inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full bg-[#e9f6f1] px-4 py-2 text-xs font-medium text-[#263532]">
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-[#b42318]"
              />
              Signal interrupted
            </span>
            <span
              className="font-[family-name:var(--font-cairo)] text-[#0b5a54]"
              dir="rtl"
              lang="ar"
            >
              خطأ في مسار الصوت والمرئيات
            </span>
          </p>

          <div
            aria-hidden="true"
            className="mx-auto mt-6 max-w-xl overflow-hidden rounded-xl bg-[#26302d] px-5 py-6 shadow-lg"
          >
            <div className="flex items-center justify-center gap-4 sm:gap-6">
              <span className="text-6xl font-extrabold text-[#7fe3d3] sm:text-7xl">
                4
              </span>
              <span className="flex h-20 w-16 flex-col items-center justify-center rounded-lg bg-white/10 text-[#7fe3d3]">
                <svg
                  fill="none"
                  height="30"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="30"
                >
                  <path d="M2 2l20 20" />
                  <path d="M16 16H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
                  <path d="M10 6h4a2 2 0 0 1 2 2v3l6-3.5v9" />
                </svg>
              </span>
              <span className="text-6xl font-extrabold text-[#7fe3d3] sm:text-7xl">
                4
              </span>
            </div>
            <div className="mt-4 flex items-center justify-center gap-3 border-t border-dashed border-white/15 pt-4">
              <Bars heights={WAVE} />
              <span className="rounded bg-[#fde3e0] px-2 py-0.5 font-mono text-xs font-bold text-[#b42318]">
                04:04
              </span>
              <Bars heights={WAVE_LOST} muted />
            </div>
          </div>

          <h1 className="mt-7 text-3xl font-extrabold text-[#172321] sm:text-4xl">
            Page not found
          </h1>
          <p
            className="mt-2 font-[family-name:var(--font-cairo)] text-2xl font-bold text-[#0b5a54]"
            dir="rtl"
            lang="ar"
          >
            الصفحة غير موجودة أو تم نقلها
          </p>
          <p className="mx-auto mt-3 max-w-lg text-base leading-relaxed text-[#44534e]">
            The episode, clip, or page you are looking for does not exist or has
            been removed. Check the address, or go back to your workspace.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              className="inline-flex h-11 items-center rounded-lg bg-[#0f766e] px-5 text-sm font-semibold text-white hover:bg-[#0b5a54] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f766e]"
              href="/"
            >
              Back to workspace
            </Link>
            <Link
              className="inline-flex h-11 items-center rounded-lg bg-[#e9f2ee] px-5 text-sm font-semibold text-[#263532] hover:bg-[#dcebe5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f766e]"
              href="/videos/new"
            >
              Upload new video
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[#eef1ef] pt-4 text-left text-xs text-[#5d6d68]">
            <p className="min-w-0">
              <span className="font-mono font-bold text-[#172321]">
                HTTP 404
              </span>{' '}
              · Requested path: <RequestedPath />
            </p>
            <CopyUrlButton />
          </div>
        </section>
      </main>
      <AppFooter />
    </>
  );
}
