'use client';

import { AlertBanner } from '@/components/feedback';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

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
    <main className="flex flex-1 items-center justify-center bg-background px-4 py-14">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-lg">
        <AlertBanner
          actions={
            <>
              <Button onClick={reset} size="sm" variant="primary">
                Try again
              </Button>
              <Link
                className="inline-flex h-9 items-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"
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
          className="mt-4 text-end font-[family-name:var(--font-cairo)] text-sm text-destructive"
          dir="rtl"
          lang="ar"
        >
          حدث خطأ أثناء تحميل الصفحة
        </p>
      </div>
    </main>
  );
}
