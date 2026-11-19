import { CopyUrlButton } from '@/components/common/copy-url-button';
import { RequestedPath } from '@/components/common/requested-path';
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
          className={`w-1.5 rounded-full ${muted ? 'bg-muted-foreground/30' : 'bg-primary'}`}
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
      <main className="flex flex-1 items-center justify-center bg-background px-4 py-10 sm:py-14">
        <section className="w-full max-w-3xl rounded-2xl border border-border bg-card px-5 py-8 text-center shadow-lg sm:px-10 sm:py-10">
          <p className="mx-auto inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full bg-muted px-4 py-2 text-xs font-medium text-foreground">
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-destructive"
              />
              Signal interrupted
            </span>
            <span
              className="font-[family-name:var(--font-cairo)] text-primary"
              dir="rtl"
              lang="ar"
            >
              خطأ في مسار الصوت والمرئيات
            </span>
          </p>

          <div
            aria-hidden="true"
            className="mx-auto mt-6 max-w-xl overflow-hidden rounded-xl bg-card border border-border px-5 py-6 shadow-lg"
          >
            <div className="flex items-center justify-center gap-4 sm:gap-6">
              <span className="text-6xl font-extrabold text-primary sm:text-7xl">
                4
              </span>
              <span className="flex h-20 w-16 flex-col items-center justify-center rounded-lg bg-muted text-primary">
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
              <span className="text-6xl font-extrabold text-primary sm:text-7xl">
                4
              </span>
            </div>
            <div className="mt-4 flex items-center justify-center gap-3 border-t border-dashed border-border pt-4">
              <Bars heights={WAVE} />
              <span className="rounded bg-destructive/10 px-2 py-0.5 font-mono text-xs font-bold text-destructive">
                04:04
              </span>
              <Bars heights={WAVE_LOST} muted />
            </div>
          </div>

          <h1 className="mt-7 text-3xl font-extrabold text-foreground sm:text-4xl">
            Page not found
          </h1>
          <p
            className="mt-2 font-[family-name:var(--font-cairo)] text-2xl font-bold text-primary"
            dir="rtl"
            lang="ar"
          >
            الصفحة غير موجودة أو تم نقلها
          </p>
          <p className="mx-auto mt-3 max-w-lg text-base leading-relaxed text-muted-foreground">
            The episode, clip, or page you are looking for does not exist or has
            been removed. Check the address, or go back to your workspace.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              href="/"
            >
              Back to workspace
            </Link>
            <Link
              className="inline-flex h-11 items-center rounded-lg bg-muted px-5 text-sm font-semibold text-foreground hover:bg-muted/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              href="/videos/new"
            >
              Upload new video
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-4 text-left text-xs text-muted-foreground">
            <p className="min-w-0">
              <span className="font-mono font-bold text-foreground">
                HTTP 404
              </span>{' '}
              · Requested path: <RequestedPath />
            </p>
            <CopyUrlButton />
          </div>
        </section>
      </main>
    </>
  );
}
