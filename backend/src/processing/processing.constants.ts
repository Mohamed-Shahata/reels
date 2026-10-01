export const PROCESSING_QUEUE_NAME = 'processing';

export const PROCESSING_RUN_JOB_NAME = 'run';

export const PROCESSING_QUEUE = Symbol('PROCESSING_QUEUE');

export interface ProcessingQueueJobPayload {
  processingJobId: string;
  type: 'TRANSCRIPTION' | 'RENDER';
}

/**
 * Stored as the job's error when the user stops it. A stopped job is a FAILED
 * job with this message, so it can be resumed with the normal retry.
 */
export const JOB_STOPPED_MESSAGE = 'Stopped by the user';

export function isStoppedJob(job: {
  status?: string;
  lastError?: string | null;
}): boolean {
  return job.status === 'FAILED' && job.lastError === JOB_STOPPED_MESSAGE;
}

export interface ProcessingQueueClient {
  enqueue(payload: ProcessingQueueJobPayload): Promise<void>;
  ensureQueued(payload: ProcessingQueueJobPayload): Promise<void>;
  /** Drops a job that has not started yet. A running job cannot be removed. */
  remove?(processingJobId: string): Promise<void>;
}
