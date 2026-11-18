import { Logger } from '@nestjs/common';
import { Pool, PoolClient, PoolConfig } from 'pg';

const TRANSIENT_PATTERNS = [
  'socket disconnected before secure tls',
  'connection terminated',
  'connection timeout',
  'timeout exceeded when trying to connect',
  'econnreset',
  'etimedout',
  'econnrefused',
  'epipe',
  'enotfound',
  'eai_again',
];

export function isTransientConnectionError(error: unknown): boolean {
  const e = error as { message?: string; code?: string } | undefined;
  const text = `${e?.code ?? ''} ${e?.message ?? ''}`.toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => text.includes(p));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * pg Pool that retries *connection establishment* on transient network/TLS
 * failures (typical with serverless Postgres such as Neon: cold starts,
 * dropped idle sockets, slow TLS handshakes). Queries are never retried
 * once a connection was obtained, so there is no risk of double execution.
 */
export class ResilientPool extends Pool {
  private readonly logger = new Logger('PrismaPool');

  constructor(
    config: PoolConfig,
    private readonly retries = 4,
    private readonly baseDelayMs = 300,
  ) {
    super(config);
    // Idle clients can be killed by the server/proxy; never crash on it.
    this.on('error', (err) => {
      this.logger.warn(`Idle client error (ignored): ${err.message}`);
    });
  }

  private async connectWithRetry(): Promise<PoolClient> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await super.connect();
      } catch (error) {
        if (attempt >= this.retries || !isTransientConnectionError(error)) {
          throw error;
        }
        const delay = this.baseDelayMs * 2 ** attempt;
        this.logger.warn(
          `DB connect failed (${(error as Error).message}); retry ${attempt + 1}/${this.retries} in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
  }

  // pg calls connect() both with and without a callback (Pool.query uses the
  // callback form internally), so support both.
  connect(): Promise<PoolClient>;
  connect(
    callback: (
      err: Error | undefined,
      client: PoolClient | undefined,
      done: (release?: Error | boolean) => void,
    ) => void,
  ): void;
  connect(
    callback?: (
      err: Error | undefined,
      client: PoolClient | undefined,
      done: (release?: Error | boolean) => void,
    ) => void,
  ): Promise<PoolClient> | void {
    const promise = this.connectWithRetry();
    if (!callback) return promise;
    promise.then(
      (client) =>
        callback(undefined, client, (release) => client.release(release)),
      (err: Error) => callback(err, undefined, () => undefined),
    );
  }
}
