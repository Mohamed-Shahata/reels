export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-[#e3ece8] motion-reduce:animate-none ${className}`}
    />
  );
}

export function VideoCardSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-[#e2eae6] bg-white"
    >
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="mt-4 h-8 w-full" />
      </div>
    </li>
  );
}

export function LibrarySkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul
      aria-busy="true"
      aria-label="Loading videos"
      className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: count }, (_, index) => (
        <VideoCardSkeleton key={index} />
      ))}
    </ul>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[#c5d3cd] bg-white px-6 py-14 text-center">
      <p className="text-base font-semibold">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-[#5d6d68]">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function ClipRowSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="flex gap-3 rounded-2xl border border-[#e2eae6] bg-[#fafcfb] p-3.5"
    >
      <Skeleton className="aspect-[9/16] w-28 shrink-0 rounded-lg sm:w-36" />
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
        <div className="space-y-2.5">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <div className="space-y-2.5">
          <Skeleton className="h-3 w-1/2" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
      </div>
    </li>
  );
}

/** Placeholder for the video workspace while the video and clips load. */
export function WorkspaceSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading video workspace" role="status">
      <div aria-hidden="true">
        <div className="mt-5 flex gap-1 rounded-2xl border border-[#e2eae6] bg-white p-1.5 shadow-[var(--shadow-surface)] sm:inline-flex">
          <Skeleton className="h-12 w-36 rounded-xl" />
          <Skeleton className="h-12 w-36 rounded-xl" />
        </div>

        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="rounded-2xl border border-[#e2eae6] bg-white p-4 shadow-[var(--shadow-surface)]">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-8 w-44 rounded-lg" />
            </div>
            <Skeleton className="mt-3 aspect-video w-full rounded-xl" />
            <Skeleton className="mt-3 h-2 w-full rounded-full" />
            <div className="mt-3 flex items-center gap-2">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-11 w-11 rounded-full" />
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-7 w-24" />
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-2xl border border-[#e2eae6] bg-white px-4 py-3 shadow-[var(--shadow-surface)]">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-5 w-32" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-16 rounded-lg" />
                  <Skeleton className="h-8 w-16 rounded-lg" />
                  <Skeleton className="h-8 w-16 rounded-lg" />
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-[#e2eae6] bg-white p-4 shadow-[var(--shadow-surface)]">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-8 w-28 rounded-lg" />
              </div>
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-8 w-16 rounded-full" />
                <Skeleton className="h-8 w-24 rounded-full" />
                <Skeleton className="h-8 w-20 rounded-full" />
              </div>
              <ul className="mt-4 space-y-3">
                <ClipRowSkeleton />
                <ClipRowSkeleton />
              </ul>
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">Loading video workspace...</span>
    </div>
  );
}
