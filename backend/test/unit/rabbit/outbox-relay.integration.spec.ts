import { PrismaService } from '../../../src/prisma/prisma.service';
import { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';
import { OutboxRelayService } from '../../../src/rabbit/outbox-relay.service';
import { REELS_EXCHANGES } from '../../../src/rabbit/rabbit.constants';
import { RabbitService } from '../../../src/rabbit/rabbit.service';

describe('Transactional Outbox Integration', () => {
  it('enqueues job and outbox event, and relays upon broker availability', async () => {
    // 1. Setup mock Prisma representing DB state
    const outboxStore: Array<{
      id: string;
      routingKey: string;
      payload: unknown;
      publishedAt: Date | null;
      attempts: number;
    }> = [];

    const jobsStore: Array<{
      id: string;
      idempotencyKey: string;
      type: string;
      status: string;
    }> = [];

    const mockPrismaTx = {
      processingJob: {
        create: jest
          .fn()
          .mockImplementation(async ({ data }: { data: any }) => {
            const job = { id: `job-${jobsStore.length + 1}`, ...data };
            jobsStore.push(job);
            return job;
          }),
      },
      outboxEvent: {
        create: jest
          .fn()
          .mockImplementation(async ({ data }: { data: any }) => {
            const event = {
              id: `outbox-${outboxStore.length + 1}`,
              ...data,
              publishedAt: null,
              attempts: 0,
            };
            outboxStore.push(event);
            return event;
          }),
      },
    };

    const mockPrisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (cb: (tx: any) => Promise<any>) => {
          return cb(mockPrismaTx);
        }),
      outboxEvent: {
        update: jest
          .fn()
          .mockImplementation(
            async ({ where, data }: { where: { id: string }; data: any }) => {
              const ev = outboxStore.find((e) => e.id === where.id);
              if (ev) {
                if (data.publishedAt) ev.publishedAt = data.publishedAt;
                if (data.attempts?.increment)
                  ev.attempts += data.attempts.increment;
              }
              return ev;
            },
          ),
      },
    };

    // 2. Mock RabbitService that can simulate broker down then up
    let isBrokerUp = false;
    const publishedMessages: Array<{
      exchange: string;
      rk: string;
      payload: unknown;
    }> = [];

    const mockRabbit = {
      publish: jest
        .fn()
        .mockImplementation(
          async (exchange: string, rk: string, payload: unknown) => {
            if (!isBrokerUp) {
              throw new Error('Broker connection refused (ECONNREFUSED)');
            }
            publishedMessages.push({ exchange, rk, payload });
            return true;
          },
        ),
    };

    const jobsService = new ProcessingJobsService(
      mockPrisma as unknown as PrismaService,
    );

    const relay = new OutboxRelayService(
      mockPrisma as unknown as PrismaService,
      mockRabbit as unknown as RabbitService,
    );
    relay.onModuleInit();

    // Step A: Broker is DOWN, enqueue a job
    isBrokerUp = false;
    const job = await mockPrisma.$transaction(async (tx: any) => {
      return jobsService.enqueue(tx, {
        userId: 'user-1',
        videoId: 'video-1',
        type: 'TRANSCRIBE',
        idempotencyKey: 'video-1:TRANSCRIBE:v1',
      });
    });

    expect(job.id).toBeDefined();
    expect(outboxStore.length).toBe(1);
    expect(outboxStore[0].publishedAt).toBeNull();

    // Step B: Relay attempts to publish while broker is down
    // Simulating $queryRaw returning pending events
    mockPrisma.$transaction.mockImplementationOnce(
      async (cb: (tx: any) => Promise<any>) => {
        return cb({
          $queryRaw: jest.fn().mockResolvedValue(
            outboxStore
              .filter((e) => e.publishedAt === null)
              .map((e) => ({
                id: e.id,
                routingKey: e.routingKey,
                payload: e.payload,
                attempts: e.attempts,
              })),
          ),
        });
      },
    );

    const publishedWhenDown = await relay.relayBatch();
    expect(publishedWhenDown).toBe(0);
    expect(outboxStore[0].publishedAt).toBeNull();
    expect(outboxStore[0].attempts).toBe(1);
    expect(publishedMessages.length).toBe(0);

    // Step C: Broker comes back UP (start broker)
    isBrokerUp = true;

    mockPrisma.$transaction.mockImplementationOnce(
      async (cb: (tx: any) => Promise<any>) => {
        return cb({
          $queryRaw: jest.fn().mockResolvedValue(
            outboxStore
              .filter((e) => e.publishedAt === null)
              .map((e) => ({
                id: e.id,
                routingKey: e.routingKey,
                payload: e.payload,
                attempts: e.attempts,
              })),
          ),
        });
      },
    );

    const publishedWhenUp = await relay.relayBatch();
    expect(publishedWhenUp).toBe(1);
    expect(outboxStore[0].publishedAt).toBeInstanceOf(Date);
    expect(outboxStore[0].attempts).toBe(2);
    expect(publishedMessages.length).toBe(1);
    expect(publishedMessages[0]).toEqual({
      exchange: REELS_EXCHANGES.WORK,
      rk: 'transcribe',
      payload: {
        processingJobId: job.id,
        videoId: 'video-1',
        userId: 'user-1',
        type: 'TRANSCRIBE',
        payload: undefined,
      },
    });

    await relay.onModuleDestroy();
  });
});
