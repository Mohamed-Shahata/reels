import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PROCESSING_QUEUE_NAME,
  PROCESSING_RUN_JOB_NAME,
  type ProcessingQueueClient,
  type ProcessingQueueJobPayload,
} from './processing.constants';

@Injectable()
export class BullProcessingQueueService implements ProcessingQueueClient {
  constructor(
    @InjectQueue(PROCESSING_QUEUE_NAME)
    private readonly queue: Queue<ProcessingQueueJobPayload>,
  ) {}

  async enqueue(payload: ProcessingQueueJobPayload): Promise<void> {
    await this.queue.add(PROCESSING_RUN_JOB_NAME, payload, {
      jobId: payload.processingJobId,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async remove(processingJobId: string): Promise<void> {
    const existing = await this.queue.getJob(processingJobId);
    if (!existing) return;

    const state = await existing.getState();
    if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
      await existing.remove();
    }
  }

  async ensureQueued(payload: ProcessingQueueJobPayload): Promise<void> {
    const existing = await this.queue.getJob(payload.processingJobId);
    if (!existing) {
      await this.enqueue(payload);
      return;
    }

    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      await existing.remove();
      await this.enqueue(payload);
    }
  }
}
