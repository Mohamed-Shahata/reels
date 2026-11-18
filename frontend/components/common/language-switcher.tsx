'use client';

import { useLanguage } from '@/lib/i18n/language-context';

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { language, toggleLanguage } = useLanguage();

  return (
    <button
      aria-label={language === 'ar' ? 'Switch to English' : 'التحويل إلى العربية'}
      className={`group inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-semibold text-muted shadow-xs transition hover:border-border-strong hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent select-none ${className}`}
      onClick={toggleLanguage}
      title={language === 'ar' ? 'Switch to English' : 'التحويل إلى العربية'}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="h-3.5 w-3.5 text-muted transition-colors group-hover:text-text"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" x2="22" y1="12" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span>{language === 'ar' ? 'English' : 'العربية'}</span>
    </button>
  );
}
