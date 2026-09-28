export const PROCESSING_QUEUE_NAME = 'processing';

export const PROCESSING_RUN_JOB_NAME = 'run';

export const PROCESSING_QUEUE = Symbol('PROCESSING_QUEUE');

export interface ProcessingQueueJobPayload {
  processingJobId: string;
  type: 'TRANSCRIPTION';
}

export interface ProcessingQueueClient {
  enqueue(payload: ProcessingQueueJobPayload): Promise<void>;
  ensureQueued(payload: ProcessingQueueJobPayload): Promise<void>;
}
