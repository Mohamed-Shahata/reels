'use client';

import { AlertBanner } from '@/components/feedback';
import Link from 'next/link';
import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center bg-[#eefaf5] px-4 py-14">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-[0_8px_30px_rgba(15,118,110,0.08)]">
        <AlertBanner
          actions={
            <>
              <button
                className="h-9 rounded-lg bg-[#0f766e] px-4 text-sm font-semibold text-white hover:bg-[#0b5a54]"
                onClick={reset}
                type="button"
              >
                Try again
              </button>
              <Link
                className="inline-flex h-9 items-center rounded-lg border border-[#d5dcd8] bg-white px-4 text-sm font-medium text-[#263532]"
                href="/"
              >
                Back to workspace
              </Link>
            </>
          }
          diagnosticKey={error.digest}
          title="Something went wrong on this page"
        >
          The page failed to load. Try again, and share the reference below with
          support if it keeps happening.
        </AlertBanner>
        <p
          className="mt-4 text-right font-[family-name:var(--font-cairo)] text-sm text-[#8f2f1f]"
          dir="rtl"
          lang="ar"
        >
          حدث خطأ أثناء تحميل الصفحة
        </p>
      </div>
    </main>
  );
}
