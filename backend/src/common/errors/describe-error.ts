/**
 * Turns anything that can be thrown into a readable message.
 *
 * The Cloudinary SDK rejects with plain objects such as
 * `{ error: { message, http_code } }` or `{ message, http_code }` instead of
 * `Error` instances, so `error instanceof Error` checks reported them as
 * "unknown error" and hid the real reason a render failed.
 */
export function describeError(
  error: unknown,
  fallback = 'unknown error',
): string {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;
  if (typeof error !== 'object' || error === null) return fallback;

  const outer = error as {
    message?: unknown;
    http_code?: unknown;
    error?: unknown;
  };
  const inner =
    typeof outer.error === 'object' && outer.error !== null
      ? (outer.error as { message?: unknown; http_code?: unknown })
      : undefined;

  const message =
    (typeof inner?.message === 'string' && inner.message) ||
    (typeof outer.message === 'string' && outer.message) ||
    (typeof outer.error === 'string' && outer.error) ||
    '';
  const code = inner?.http_code ?? outer.http_code;

  if (!message) {
    try {
      return JSON.stringify(error).slice(0, 500) || fallback;
    } catch {
      return fallback;
    }
  }
  return typeof code === 'number' ? `${message} (HTTP ${code})` : message;
}

/** Wraps a thrown value in a real Error so stack traces and messages survive. */
export function toError(error: unknown, context?: string): Error {
  if (error instanceof Error) {
    if (!context) return error;
    return new Error(`${context}: ${error.message}`, { cause: error });
  }
  const message = describeError(error);
  return new Error(context ? `${context}: ${message}` : message, {
    cause: error,
  });
}
