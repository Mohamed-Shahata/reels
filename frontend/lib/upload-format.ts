export type SpokenLanguage = 'ar' | 'en';

export const SPOKEN_LANGUAGES: {
  id: SpokenLanguage;
  label: string;
  native: string;
}[] = [
  {
    id: 'ar',
    label: 'Arabic (Modern Standard / Gulf / Egyptian)',
    native: 'العربية الفصحى واللهجات الخليجية والمصرية',
  },
  { id: 'en', label: 'English', native: 'English' },
];

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatResolution(height: number | null): string | null {
  return height && height > 0 ? `${Math.round(height)}p` : null;
}

export function formatClock(durationSec: number): string {
  const total = Math.max(0, Math.floor(durationSec));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
    : `${minutes}:${ss}`;
}

/** Remaining time estimate from elapsed time and percent uploaded. */
export function estimateRemaining(
  elapsedMs: number,
  percent: number,
): string | null {
  if (percent <= 0 || percent >= 100 || elapsedMs < 3000) return null;
  const remainingSec = ((elapsedMs / percent) * (100 - percent)) / 1000;
  if (remainingSec < 60) return '~less than a minute left';
  const minutes = Math.ceil(remainingSec / 60);
  return `~${minutes} ${minutes === 1 ? 'min' : 'mins'} left`;
}

export function titleFromFileName(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[_]+/g, ' ')
      .trim() || 'Untitled video'
  );
}
