import { Injectable } from '@nestjs/common';
import type {
  ProcessingQueueClient,
  ProcessingQueueJobPayload,
} from './processing.constants';

@Injectable()
export class InMemoryProcessingQueueService implements ProcessingQueueClient {
  readonly enqueued = new Map<string, ProcessingQueueJobPayload>();

  enqueue(payload: ProcessingQueueJobPayload): Promise<void> {
    this.enqueued.set(payload.processingJobId, payload);
    return Promise.resolve();
  }

  ensureQueued(payload: ProcessingQueueJobPayload): Promise<void> {
    if (!this.enqueued.has(payload.processingJobId)) {
      return this.enqueue(payload);
    }
    return Promise.resolve();
  }
}
