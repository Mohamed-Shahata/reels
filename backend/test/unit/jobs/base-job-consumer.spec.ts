import type { ConsumeMessage } from 'amqplib';
import type { ProcessingJob } from '../../../src/generated/prisma/client';
import {
  BaseJobConsumer,
  type JobExecutionContext,
} from '../../../src/jobs/base/base-job-consumer';
import { RetryableJobError } from '../../../src/jobs/errors/job.error';
import { JobReaperService } from '../../../src/jobs/reaper/job-reaper.service';
import {
  REELS_EXCHANGES,
  type ReelsQueueName,
} from '../../../src/rabbit/rabbit.constants';

class TestConsumer extends BaseJobConsumer<{ testProp?: string }> {
  protected readonly queue: ReelsQueueName = 'transcribe';
  public handlerFn: jest.Mock = jest.fn();

  protected async handle(
    job: ProcessingJob,
    payload: { testProp?: string },
    ctx: JobExecutionContext,
  ): Promise<void> {
    await this.handlerFn(job, payload, ctx);
  }
}

describe('Job Runner Framework (BaseJobConsumer & Reaper)', () => {
  let consumer: TestConsumer;
  let mockPrisma: any;
  let mockRabbit: any;
  let jobsStore: Map<string, any>;
  let outboxStore: any[];
  let jobEventsStore: any[];

  beforeEach(() => {
    jobsStore = new Map();
    outboxStore = [];
    jobEventsStore = [];

    mockPrisma = {
      $queryRaw: jest
        .fn()
        .mockImplementation(
          async (strings: TemplateStringsArray, ...values: any[]) => {
            const query = strings.join('?');
            if (query.includes('UPDATE "ProcessingJob"')) {
              const jobId = values[1];
              const job = jobsStore.get(jobId);
              if (
                job &&
                (job.status === 'QUEUED' || job.status === 'RETRYING')
              ) {
                job.status = 'RUNNING';
                job.lockedBy = values[0];
                job.heartbeatAt = new Date();
                return [job];
              }
              return [];
            }
            if (query.includes('pg_try_advisory_xact_lock')) {
              return [{ pg_try_advisory_xact_lock: true }];
            }
            return [];
          },
        ),
      $transaction: jest
        .fn()
        .mockImplementation(async (cb: (tx: any) => Promise<any>) => {
          return cb(mockPrisma);
        }),
      processingJob: {
        findUnique: jest
          .fn()
          .mockImplementation(async ({ where }: { where: { id: string } }) => {
            return jobsStore.get(where.id) ?? null;
          }),
        findMany: jest
          .fn()
          .mockImplementation(async ({ where }: { where: any }) => {
            const result: any[] = [];
            for (const job of jobsStore.values()) {
              if (where.status && job.status !== where.status) continue;
              if (
                where.heartbeatAt?.lt &&
                job.heartbeatAt >= where.heartbeatAt.lt
              )
                continue;
              result.push(job);
            }
            return result;
          }),
        update: jest
          .fn()
          .mockImplementation(
            async ({ where, data }: { where: { id: string }; data: any }) => {
              const job = jobsStore.get(where.id);
              if (job) {
                Object.assign(job, data);
              }
              return job;
            },
          ),
      },
      outboxEvent: {
        create: jest
          .fn()
          .mockImplementation(async ({ data }: { data: any }) => {
            outboxStore.push(data);
            return { id: `outbox-${outboxStore.length}`, ...data };
          }),
      },
      jobEvent: {
        create: jest
          .fn()
          .mockImplementation(async ({ data }: { data: any }) => {
            jobEventsStore.push(data);
            return { id: `event-${jobEventsStore.length}`, ...data };
          }),
      },
      video: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'video-1', status: 'PROCESSING' }),
        update: jest.fn().mockResolvedValue({ id: 'video-1', status: 'READY' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockRabbit = {
      publish: jest.fn().mockResolvedValue(true),
      consume: jest.fn(),
    };

    consumer = new TestConsumer(mockPrisma, mockRabbit);
  });

  function createMsg(jobId: string): ConsumeMessage {
    return {
      content: Buffer.from(
        JSON.stringify({
          processingJobId: jobId,
          videoId: 'video-1',
          type: 'TRANSCRIBE',
        }),
      ),
    } as unknown as ConsumeMessage;
  }

  describe('(a) retryable error routes through tiers and ends at DLQ upon max attempts', () => {
    it('routes through tier 10s on first retryable failure', async () => {
      const jobId = 'job-retry-1';
      jobsStore.set(jobId, {
        id: jobId,
        videoId: 'video-1',
        type: 'TRANSCRIBE',
        status: 'QUEUED',
        attempt: 0,
        maxAttempts: 3,
      });

      consumer.handlerFn.mockRejectedValueOnce(
        new RetryableJobError('Network timeout', { code: 'NETWORK_TIMEOUT' }),
      );

      const msg = createMsg(jobId);
      const ack = jest.fn();
      const nack = jest.fn();

      await consumer.onMessage(
        msg,
        { processingJobId: jobId, type: 'TRANSCRIBE' },
        ack,
        nack,
      );

      const job = jobsStore.get(jobId);
      expect(job.status).toBe('RETRYING');
      expect(job.attempt).toBe(1);
      expect(job.errorCode).toBe('NETWORK_TIMEOUT');

      // Published to retry tier 10s
      expect(mockRabbit.publish).toHaveBeenCalledWith(
        REELS_EXCHANGES.RETRY,
        'transcribe.retry.10s',
        expect.anything(),
        expect.objectContaining({
          headers: { 'x-attempt': 1 },
        }),
      );
      expect(ack).toHaveBeenCalled();
    });

    it('routes to DLQ when max attempts is reached', async () => {
      const jobId = 'job-max-reached';
      jobsStore.set(jobId, {
        id: jobId,
        videoId: 'video-1',
        type: 'TRANSCRIBE',
        status: 'RETRYING',
        attempt: 2, // Next attempt is 3, which equals maxAttempts
        maxAttempts: 3,
      });

      consumer.handlerFn.mockRejectedValueOnce(
        new RetryableJobError('Server 500 error', { code: 'SERVER_ERROR' }),
      );

      const msg = createMsg(jobId);
      const ack = jest.fn();
      const nack = jest.fn();

      await consumer.onMessage(
        msg,
        { processingJobId: jobId, type: 'TRANSCRIBE' },
        ack,
        nack,
      );

      const job = jobsStore.get(jobId);
      expect(job.status).toBe('FAILED');
      expect(job.attempt).toBe(3);
      expect(job.errorCode).toBe('SERVER_ERROR');

      // Published to DLQ via DLX
      expect(mockRabbit.publish).toHaveBeenCalledWith(
        REELS_EXCHANGES.DLX,
        'transcribe.dead',
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-error-code': 'SERVER_ERROR' }),
        }),
      );
      expect(ack).toHaveBeenCalled();
    });
  });

  describe('(b) duplicate message executes only once (idempotent claim)', () => {
    it('claims first message and safely skips duplicate delivery', async () => {
      const jobId = 'job-duplicate-test';
      jobsStore.set(jobId, {
        id: jobId,
        videoId: 'video-1',
        type: 'TRANSCRIBE',
        status: 'QUEUED',
        attempt: 0,
        maxAttempts: 3,
      });

      consumer.handlerFn.mockResolvedValue(undefined);

      const msg1 = createMsg(jobId);
      const ack1 = jest.fn();
      const nack1 = jest.fn();

      // First delivery
      await consumer.onMessage(
        msg1,
        { processingJobId: jobId, type: 'TRANSCRIBE' },
        ack1,
        nack1,
      );

      expect(consumer.handlerFn).toHaveBeenCalledTimes(1);
      expect(ack1).toHaveBeenCalled();

      // Second duplicate delivery (job is already COMPLETED)
      const msg2 = createMsg(jobId);
      const ack2 = jest.fn();
      const nack2 = jest.fn();

      await consumer.onMessage(
        msg2,
        { processingJobId: jobId, type: 'TRANSCRIBE' },
        ack2,
        nack2,
      );

      // Handler is NOT invoked again
      expect(consumer.handlerFn).toHaveBeenCalledTimes(1);
      // But message is acknowledged so it does not block the queue
      expect(ack2).toHaveBeenCalled();
    });
  });

  describe('(c) kill -9 worker mid-job is recovered by Reaper', () => {
    it('detects dead heartbeat and re-queues job via Transactional Outbox', async () => {
      const reaper = new JobReaperService(mockPrisma);
      reaper.onModuleInit();

      const jobId = 'job-killed-worker';
      const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);

      jobsStore.set(jobId, {
        id: jobId,
        videoId: 'video-1',
        type: 'TRANSCRIBE',
        status: 'RUNNING',
        heartbeatAt: threeMinutesAgo,
        attempt: 0,
        maxAttempts: 3,
      });

      const reaped = await reaper.reapDeadJobs();
      expect(reaped).toBe(1);

      const job = jobsStore.get(jobId);
      expect(job.status).toBe('RETRYING');
      expect(job.attempt).toBe(1);
      expect(job.lockedBy).toBeNull();

      // Created OutboxEvent for re-enqueueing
      expect(outboxStore.length).toBe(1);
      expect(outboxStore[0].routingKey).toBe('transcribe');
      expect(outboxStore[0].payload.processingJobId).toBe(jobId);
      reaper.onModuleDestroy();
    });
  });

  describe('(d) cancel halts running job and cleans up workdir', () => {
    it('aborts execution when job is marked CANCELLED and acknowledges message', async () => {
      const jobId = 'job-cancelled-mid-run';
      const jobRecord = {
        id: jobId,
        videoId: 'video-1',
        type: 'TRANSCRIBE',
        status: 'QUEUED',
        attempt: 0,
        maxAttempts: 3,
      };
      jobsStore.set(jobId, jobRecord);

      consumer.handlerFn.mockImplementation(
        async (_job, _payload, ctx: JobExecutionContext) => {
          // User cancels job in database while handler is running
          jobRecord.status = 'CANCELLED';
          const cancelled = await ctx.isCancelled();
          expect(cancelled).toBe(true);
        },
      );

      const msg = createMsg(jobId);
      const ack = jest.fn();
      const nack = jest.fn();

      await consumer.onMessage(
        msg,
        { processingJobId: jobId, type: 'TRANSCRIBE' },
        ack,
        nack,
      );

      // Status stays CANCELLED (does NOT overwrite to COMPLETED)
      expect(jobRecord.status).toBe('CANCELLED');
      expect(ack).toHaveBeenCalled();
    });
  });

  describe('(e) disk space hygiene check', () => {
    it('retries job if free disk space is lower than required threshold', async () => {
      const jobId = 'job-disk-full';
      const jobRecord = {
        id: jobId,
        videoId: 'video-1',
        type: 'TRANSCRIBE',
        status: 'QUEUED',
        attempt: 0,
        maxAttempts: 3,
      };
      jobsStore.set(jobId, jobRecord);

      // Spy on checkDiskSpace to simulate low disk space
      jest.spyOn(consumer as any, 'checkDiskSpace').mockRejectedValue(
        new RetryableJobError('Insufficient disk space on worker', {
          code: 'INSUFFICIENT_DISK_SPACE',
        }),
      );

      const msg = createMsg(jobId);
      const ack = jest.fn();
      const nack = jest.fn();

      await consumer.onMessage(
        msg,
        { processingJobId: jobId, type: 'TRANSCRIBE' },
        ack,
        nack,
      );

      // Handler was not run
      expect(consumer.handlerFn).not.toHaveBeenCalled();
      // Job moved to RETRYING and published to retry exchange
      expect(jobRecord.status).toBe('RETRYING');
      expect(mockRabbit.publish).toHaveBeenCalledWith(
        REELS_EXCHANGES.RETRY,
        'transcribe.retry.10s',
        expect.anything(),
        expect.anything(),
      );
      expect(ack).toHaveBeenCalled();
    });
  });

  describe('(f) video status aggregation', () => {
    it('marks video READY when all 4 pipeline stages are completed', async () => {
      const jobId = 'job-final-analyze';
      jobsStore.set(jobId, {
        id: jobId,
        videoId: 'video-1',
        type: 'ANALYZE',
        status: 'QUEUED',
        attempt: 0,
        maxAttempts: 3,
      });

      // All 4 stages completed
      mockPrisma.processingJob.findMany.mockResolvedValue([
        { type: 'INGEST', status: 'COMPLETED' },
        { type: 'TRANSCRIBE', status: 'COMPLETED' },
        { type: 'SEGMENT', status: 'COMPLETED' },
        { type: 'ANALYZE', status: 'COMPLETED' },
      ]);

      const msg = createMsg(jobId);
      const ack = jest.fn();
      const nack = jest.fn();

      await consumer.onMessage(
        msg,
        { processingJobId: jobId, type: 'ANALYZE' },
        ack,
        nack,
      );

      expect(mockPrisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: 'READY', failedStage: null },
      });
      expect(ack).toHaveBeenCalled();
    });

    it('marks video FAILED with failedStage when a stage job fails permanently', async () => {
      const jobId = 'job-fatal-transcribe';
      jobsStore.set(jobId, {
        id: jobId,
        videoId: 'video-1',
        type: 'TRANSCRIBE',
        status: 'QUEUED',
        attempt: 2,
        maxAttempts: 3,
      });

      consumer.handlerFn.mockRejectedValue(
        new Error('Groq invalid model parameter format'),
      );

      const msg = createMsg(jobId);
      const ack = jest.fn();
      const nack = jest.fn();

      await consumer.onMessage(
        msg,
        { processingJobId: jobId, type: 'TRANSCRIBE' },
        ack,
        nack,
      );

      expect(mockPrisma.video.updateMany).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: 'FAILED', failedStage: 'TRANSCRIBE' },
      });
      expect(ack).toHaveBeenCalled();
    });
  });
});
