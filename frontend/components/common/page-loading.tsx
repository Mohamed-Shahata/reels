export function PageLoading({ label = 'Loading...' }: { label?: string }) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[#f6f8f7] px-5 text-sm text-[#5f6e69]"
      aria-live="polite"
    >
      {label}
    </main>
  );
}
