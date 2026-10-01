import type { LibrarySummary } from './api';

export type LibraryFilter = 'all' | 'completed' | 'in-progress';
export type LibrarySort = 'recent' | 'oldest' | 'title' | 'duration';

export function isInProgress(video: LibrarySummary): boolean {
  if (video.status === 'UPLOADING') return true;
  return (
    video.status === 'READY' &&
    (video.transcriptionState === 'PENDING' ||
      video.transcriptionState === 'RUNNING')
  );
}

export function isCompleted(video: LibrarySummary): boolean {
  return video.reelCount > 0;
}

export function filterVideos(
  videos: LibrarySummary[],
  filter: LibraryFilter,
): LibrarySummary[] {
  if (filter === 'completed') return videos.filter(isCompleted);
  if (filter === 'in-progress') return videos.filter(isInProgress);
  return videos;
}

export function sortVideos(
  videos: LibrarySummary[],
  sort: LibrarySort,
): LibrarySummary[] {
  const copy = [...videos];
  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'ar'));
    case 'duration':
      return copy.sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0));
    default:
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export function formatDuration(durationSec: number): string {
  const total = Math.floor(durationSec);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
