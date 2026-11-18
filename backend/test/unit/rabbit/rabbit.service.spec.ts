import { ConfigService } from '@nestjs/config';
import type { ConfirmChannel } from 'amqplib';
import type { Env } from '../../../src/config/env.schema';
import {
  REELS_EXCHANGES,
  REELS_QUEUES,
  RETRY_TIERS,
} from '../../../src/rabbit/rabbit.constants';
import { RabbitService } from '../../../src/rabbit/rabbit.service';

describe('RabbitService', () => {
  let service: RabbitService;
  let mockConfig: Partial<ConfigService>;
  let mockChannel: Partial<ConfirmChannel>;

  beforeEach(() => {
    mockConfig = {
      get: jest.fn().mockReturnValue('amqp://guest:guest@localhost:5672'),
    };
    mockChannel = {
      assertExchange: jest.fn().mockResolvedValue({ exchange: 'test' }),
      assertQueue: jest.fn().mockResolvedValue({
        queue: 'test',
        messageCount: 0,
        consumerCount: 0,
      }),
      bindQueue: jest.fn().mockResolvedValue({}),
      prefetch: jest.fn().mockResolvedValue({}),
      consume: jest.fn().mockResolvedValue({ consumerTag: 'test-tag' }),
      publish: jest.fn().mockReturnValue(true),
      ack: jest.fn(),
      nack: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };

    service = new RabbitService(
      mockConfig as unknown as ConfigService<Env, true>,
    );
  });

  describe('assertTopology', () => {
    it('asserts all exchanges, queues, retry tiers, and DLQs', async () => {
      const channel = mockChannel as ConfirmChannel;
      await service.assertTopology(channel);

      // 1. Verify exchanges
      expect(channel.assertExchange).toHaveBeenCalledWith(
        REELS_EXCHANGES.WORK,
        'direct',
        { durable: true },
      );
      expect(channel.assertExchange).toHaveBeenCalledWith(
        REELS_EXCHANGES.RETRY,
        'direct',
        { durable: true },
      );
      expect(channel.assertExchange).toHaveBeenCalledWith(
        REELS_EXCHANGES.DLX,
        'direct',
        { durable: true },
      );

      // 2. Verify all queues asserted and bound
      for (const q of REELS_QUEUES) {
        expect(channel.assertQueue).toHaveBeenCalledWith(
          q,
          expect.objectContaining({
            durable: true,
            arguments: expect.objectContaining({
              'x-dead-letter-exchange': REELS_EXCHANGES.DLX,
              'x-dead-letter-routing-key': `${q}.dead`,
            }),
          }),
        );
        expect(channel.bindQueue).toHaveBeenCalledWith(
          q,
          REELS_EXCHANGES.WORK,
          q,
        );

        // Retry queues
        for (const tier of RETRY_TIERS) {
          const retryQueue = `${q}.retry.${tier.name}`;
          expect(channel.assertQueue).toHaveBeenCalledWith(
            retryQueue,
            expect.objectContaining({
              durable: true,
              arguments: expect.objectContaining({
                'x-message-ttl': tier.ttlMs,
                'x-dead-letter-exchange': REELS_EXCHANGES.WORK,
                'x-dead-letter-routing-key': q,
              }),
            }),
          );
          expect(channel.bindQueue).toHaveBeenCalledWith(
            retryQueue,
            REELS_EXCHANGES.RETRY,
            retryQueue,
          );
        }

        // DLQ
        const dlq = `${q}.dlq`;
        expect(channel.assertQueue).toHaveBeenCalledWith(dlq, {
          durable: true,
        });
        expect(channel.bindQueue).toHaveBeenCalledWith(
          dlq,
          REELS_EXCHANGES.DLX,
          `${q}.dead`,
        );
      }
    });
  });

  describe('publish', () => {
    it('throws if publishChannel is not initialized', async () => {
      await expect(
        service.publish('reels.work', 'test', { foo: 'bar' }),
      ).rejects.toThrow('RabbitMQ publish channel is not initialized');
    });

    it('delegates to publishChannel when initialized', async () => {
      const mockPublishChannel = {
        publish: jest.fn().mockResolvedValue(true),
        close: jest.fn(),
      };
      (
        service as unknown as { publishChannel: typeof mockPublishChannel }
      ).publishChannel = mockPublishChannel;

      const result = await service.publish('reels.work', 'ingest', { id: 123 });
      expect(result).toBe(true);
      expect(mockPublishChannel.publish).toHaveBeenCalledWith(
        'reels.work',
        'ingest',
        { id: 123 },
        expect.objectContaining({
          persistent: true,
          contentType: 'application/json',
        }),
      );
    });
  });

  describe('consume message handling', () => {
    it('throws if connection is not initialized', async () => {
      await expect(service.consume('ingest', jest.fn())).rejects.toThrow(
        'RabbitMQ connection is not initialized',
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('closes all channels and connection cleanly without error', async () => {
      const mockPublishChannel = {
        close: jest.fn().mockResolvedValue(undefined),
      };
      const mockConsumerChannel = {
        close: jest.fn().mockResolvedValue(undefined),
      };
      const mockConn = {
        close: jest.fn().mockResolvedValue(undefined),
      };

      const anyService = service as unknown as {
        publishChannel: typeof mockPublishChannel;
        consumerChannels: (typeof mockConsumerChannel)[];
        connection: typeof mockConn;
      };

      anyService.publishChannel = mockPublishChannel;
      anyService.consumerChannels = [mockConsumerChannel];
      anyService.connection = mockConn;

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(mockPublishChannel.close).toHaveBeenCalled();
      expect(mockConsumerChannel.close).toHaveBeenCalled();
      expect(mockConn.close).toHaveBeenCalled();
    });
  });
});
