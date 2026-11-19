import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../../../src/health/health.controller';
import { AdminQueuesController } from '../../../src/health/admin-queues.controller';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { RabbitService } from '../../../src/rabbit/rabbit.service';
import type { S3StorageService } from '../../../src/storage/s3-storage.service';

describe('HealthController and AdminQueuesController (Observability)', () => {
  let healthController: HealthController;
  let adminQueuesController: AdminQueuesController;
  let prismaMock: { $queryRaw: jest.Mock };
  let rabbitMock: { checkHealth: jest.Mock; inspectQueues: jest.Mock };
  let s3Mock: { checkHealth: jest.Mock };

  beforeEach(() => {
    prismaMock = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    rabbitMock = {
      checkHealth: jest.fn().mockResolvedValue(true),
      inspectQueues: jest.fn().mockResolvedValue({
        queues: [
          { queue: 'ingest', isDlq: false, messageCount: 0, consumerCount: 2 },
          {
            queue: 'ingest.dlq',
            isDlq: true,
            messageCount: 0,
            consumerCount: 0,
          },
        ],
        totalDeadLetters: 0,
        alert: false,
      }),
    };
    s3Mock = {
      checkHealth: jest.fn().mockResolvedValue(true),
    };

    healthController = new HealthController(
      prismaMock as unknown as PrismaService,
      rabbitMock as unknown as RabbitService,
      s3Mock as unknown as S3StorageService,
    );
    adminQueuesController = new AdminQueuesController(
      rabbitMock as unknown as RabbitService,
    );
  });

  describe('GET /health', () => {
    it('returns ok with all service statuses when DB, RabbitMQ, and S3 are healthy', async () => {
      const res = await healthController.check();
      expect(res.status).toBe('ok');
      expect(res.database).toBe('up');
      expect(res.services).toEqual({
        database: 'up',
        rabbitmq: 'up',
        storage: 'up',
      });
      expect(typeof res.uptimeSec).toBe('number');
      expect(res.timestamp).toBeDefined();
    });

    it('throws 503 ServiceUnavailableException when DB is down', async () => {
      prismaMock.$queryRaw.mockRejectedValueOnce(
        new Error('Connection timeout'),
      );
      await expect(healthController.check()).rejects.toThrow(
        new ServiceUnavailableException('Database is unreachable'),
      );
    });

    it('throws 503 ServiceUnavailableException when RabbitMQ is disconnected', async () => {
      rabbitMock.checkHealth.mockResolvedValueOnce(false);
      await expect(healthController.check()).rejects.toThrow(
        new ServiceUnavailableException('RabbitMQ is disconnected'),
      );
    });

    it('throws 503 ServiceUnavailableException when S3 storage is unreachable', async () => {
      s3Mock.checkHealth.mockResolvedValueOnce(false);
      await expect(healthController.check()).rejects.toThrow(
        new ServiceUnavailableException('S3 storage is unreachable'),
      );
    });
  });

  describe('GET /admin/queues', () => {
    it('returns queue metrics with alert false when DLQ is empty', async () => {
      const res = await adminQueuesController.getQueuesStatus();
      expect(res.queues.length).toBe(2);
      expect(res.totalDeadLetters).toBe(0);
      expect(res.alert).toBe(false);
    });

    it('returns alert true and dead letter count when DLQ has pending messages', async () => {
      rabbitMock.inspectQueues.mockResolvedValueOnce({
        queues: [
          { queue: 'ingest', isDlq: false, messageCount: 5, consumerCount: 2 },
          {
            queue: 'ingest.dlq',
            isDlq: true,
            messageCount: 3,
            consumerCount: 0,
          },
        ],
        totalDeadLetters: 3,
        alert: true,
      });

      const res = await adminQueuesController.getQueuesStatus();
      expect(res.totalDeadLetters).toBe(3);
      expect(res.alert).toBe(true);
    });
  });
});
