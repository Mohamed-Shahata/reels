export function AppFooter() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dfe6e2] bg-white px-5 py-4 text-xs text-[#5d6d68] sm:px-8">
      <span>
        <span className="font-mono font-semibold text-[#0f766e]">REELCAST</span>{' '}
        © {new Date().getFullYear()} Reelcast Studio. Built for Arabic Creators.
      </span>
      <span
        className="font-[family-name:var(--font-cairo)]"
        dir="rtl"
        lang="ar"
      >
        تحرير مرئي دقيق للبودكاست العربي
      </span>
    </footer>
  );
}
