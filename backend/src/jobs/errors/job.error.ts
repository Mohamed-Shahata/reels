export const JOB_ERROR_CODES = {
  NO_AUDIO_TRACK: 'NO_AUDIO_TRACK',
  DURATION_EXCEEDED: 'DURATION_EXCEEDED',
  CORRUPT_MEDIA: 'CORRUPT_MEDIA',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  STORAGE_ERROR: 'STORAGE_ERROR',
  INSUFFICIENT_DISK_SPACE: 'INSUFFICIENT_DISK_SPACE',
  TRANSCRIBE_FAILED: 'TRANSCRIBE_FAILED',
  RENDER_FAILED: 'RENDER_FAILED',
} as const;

export interface AppJobErrorOptions {
  code: string;
  retryable?: boolean;
  userMessage?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppJobError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly userMessage?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: AppJobErrorOptions) {
    super(message);
    this.name = 'AppJobError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.userMessage = options.userMessage;
    this.details = options.details;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export class RetryableJobError extends AppJobError {
  constructor(message: string, options: Omit<AppJobErrorOptions, 'retryable'>) {
    super(message, { ...options, retryable: true });
    this.name = 'RetryableJobError';
  }
}

export class FatalJobError extends AppJobError {
  constructor(message: string, options: Omit<AppJobErrorOptions, 'retryable'>) {
    super(message, { ...options, retryable: false });
    this.name = 'FatalJobError';
  }
}

export function isJobRetryable(error: unknown): boolean {
  if (error instanceof AppJobError) {
    return error.retryable;
  }

  if (error && typeof error === 'object') {
    const err = error as {
      code?: string;
      status?: number;
      statusCode?: number;
      name?: string;
      message?: string;
    };
    // Rate limit 429
    if (err.status === 429 || err.statusCode === 429) return true;
    // 5xx server errors
    if (typeof err.status === 'number' && err.status >= 500 && err.status < 600)
      return true;
    if (
      typeof err.statusCode === 'number' &&
      err.statusCode >= 500 &&
      err.statusCode < 600
    )
      return true;
    // Network / Socket / Timeout
    const code = err.code ?? '';
    if (
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EHOSTUNREACH',
        'ENOTFOUND',
        'EAI_AGAIN',
      ].includes(code)
    ) {
      return true;
    }
    // FFmpeg killed by signal (OOM, SIGKILL/SIGTERM)
    if (
      err.message &&
      (err.message.includes('SIGKILL') ||
        err.message.includes('SIGTERM') ||
        err.message.includes('ENOMEM'))
    ) {
      return true;
    }
  }

  return false;
}
