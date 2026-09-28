const STORAGE_PREFIX = 'podcast-reels:pending-upload:';

export interface PendingUpload {
  fileFingerprint: string;
  nextByte: number;
  title: string;
  uploadId: string;
  videoId: string;
}

export function getFileFingerprint(file: File): string {
  return [file.name, file.size, file.lastModified, file.type].join(':');
}

export function loadPendingUpload(file: File): PendingUpload | null {
  try {
    const value = window.localStorage.getItem(key(getFileFingerprint(file)));
    if (!value) return null;
    const upload = JSON.parse(value) as PendingUpload;
    return upload.fileFingerprint === getFileFingerprint(file) ? upload : null;
  } catch {
    return null;
  }
}

export function savePendingUpload(upload: PendingUpload): void {
  window.localStorage.setItem(
    key(upload.fileFingerprint),
    JSON.stringify(upload),
  );
}

export function clearPendingUpload(file: File): void {
  window.localStorage.removeItem(key(getFileFingerprint(file)));
}

function key(fingerprint: string): string {
  return `${STORAGE_PREFIX}${fingerprint}`;
}
