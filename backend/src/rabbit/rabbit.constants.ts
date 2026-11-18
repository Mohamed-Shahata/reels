export const REELS_EXCHANGES = {
  WORK: 'reels.work',
  RETRY: 'reels.retry',
  DLX: 'reels.dlx',
} as const;

export const REELS_QUEUES = [
  'ingest',
  'transcribe',
  'segment',
  'analyze',
  'render',
  'cleanup',
] as const;

export type ReelsQueueName = (typeof REELS_QUEUES)[number];

export const RETRY_TIERS = [
  { name: '10s', ttlMs: 10_000 },
  { name: '1m', ttlMs: 60_000 },
  { name: '5m', ttlMs: 300_000 },
] as const;
