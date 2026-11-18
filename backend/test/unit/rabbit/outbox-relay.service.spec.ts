import type { PrismaService } from '../../../src/prisma/prisma.service';
import { OutboxRelayService } from '../../../src/rabbit/outbox-relay.service';
import { REELS_EXCHANGES } from '../../../src/rabbit/rabbit.constants';
import type { RabbitService } from '../../../src/rabbit/rabbit.service';

describe('OutboxRelayService', () => {
  let relay: OutboxRelayService;
  let mockPrisma: {
    $transaction: jest.Mock;
    outboxEvent: {
      update: jest.Mock;
    };
  };
  let mockRabbit: {
    publish: jest.Mock;
  };

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn(),
      outboxEvent: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mockRabbit = {
      publish: jest.fn().mockResolvedValue(true),
    };

    relay = new OutboxRelayService(
      mockPrisma as unknown as PrismaService,
      mockRabbit as unknown as RabbitService,
    );
  });

  afterEach(async () => {
    await relay.onModuleDestroy();
  });

  it('publishes pending outbox events and marks them as published', async () => {
    relay.onModuleInit();

    const mockEvents = [
      {
        id: 'event-1',
        routingKey: 'transcribe',
        payload: { processingJobId: 'job-1' },
        attempts: 0,
      },
      {
        id: 'event-2',
        routingKey: 'render',
        payload: { processingJobId: 'job-2' },
        attempts: 0,
      },
    ];

    mockPrisma.$transaction.mockImplementation(
      async (cb: (tx: { $queryRaw: jest.Mock }) => Promise<unknown>) => {
        return cb({
          $queryRaw: jest.fn().mockResolvedValue(mockEvents),
        });
      },
    );

    const published = await relay.relayBatch();
    expect(published).toBe(2);

    expect(mockRabbit.publish).toHaveBeenCalledWith(
      REELS_EXCHANGES.WORK,
      'transcribe',
      { processingJobId: 'job-1' },
    );
    expect(mockRabbit.publish).toHaveBeenCalledWith(
      REELS_EXCHANGES.WORK,
      'render',
      { processingJobId: 'job-2' },
    );

    expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        publishedAt: expect.any(Date) as unknown,
        attempts: { increment: 1 },
      },
    });
    expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-2' },
      data: {
        publishedAt: expect.any(Date) as unknown,
        attempts: { increment: 1 },
      },
    });
  });

  it('increments attempts without setting publishedAt when publish fails', async () => {
    relay.onModuleInit();

    const mockEvents = [
      {
        id: 'event-fail',
        routingKey: 'transcribe',
        payload: { processingJobId: 'job-fail' },
        attempts: 0,
      },
    ];

    mockPrisma.$transaction.mockImplementation(
      async (cb: (tx: { $queryRaw: jest.Mock }) => Promise<unknown>) => {
        return cb({
          $queryRaw: jest.fn().mockResolvedValue(mockEvents),
        });
      },
    );

    mockRabbit.publish.mockRejectedValueOnce(new Error('Broker unavailable'));

    const published = await relay.relayBatch();
    expect(published).toBe(0);

    expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-fail' },
      data: {
        attempts: { increment: 1 },
      },
    });
  });
});
