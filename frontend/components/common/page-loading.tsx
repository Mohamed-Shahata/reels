export function PageLoading({ label = 'Loading...' }: { label?: string }) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-5 text-sm text-muted-foreground"
      aria-live="polite"
    >
      {label}
    </main>
  );
}
