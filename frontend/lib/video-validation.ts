import type { UploadConstraints } from './api';

function fileExtension(fileName: string): string {
  const extension = fileName.split('.').pop();
  return extension?.toLowerCase() ?? '';
}

export function validateVideoFile(
  file: File,
  constraints: UploadConstraints,
): string | null {
  if (!constraints.allowedFormats.includes(fileExtension(file.name))) {
    return `Choose a ${constraints.allowedFormats.join(', ')} video file.`;
  }

  if (file.size > constraints.maxFileSizeBytes) {
    return 'This video is larger than the allowed upload size.';
  }

  return null;
}

export function validateVideoDuration(
  durationSec: number,
  constraints: UploadConstraints,
): string | null {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return 'This video duration could not be read.';
  }

  if (durationSec > constraints.maxDurationSec) {
    return 'This video is longer than the allowed upload duration.';
  }

  return null;
}
