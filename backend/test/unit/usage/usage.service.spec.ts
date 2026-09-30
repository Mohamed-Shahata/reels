import { BadRequestException, HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.schema';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { UsageService } from '../../../src/usage/usage.service';

function createService(prisma: Record<string, unknown>, limit = 3) {
  const config = {
    get: (key: 'SEGMENTATION_MONTHLY_RUN_LIMIT') =>
      key === 'SEGMENTATION_MONTHLY_RUN_LIMIT' ? limit : undefined,
  };
  return new UsageService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService<Env, true>,
  );
}

describe('UsageService', () => {
  it('returns usage for the requested month and user', async () => {
    const usageRecord = {
      findUnique: jest.fn().mockResolvedValue({
        uploadedSeconds: 150,
        clipCount: 3,
        aiRunCount: 2,
      }),
    };
    const service = createService({ usageRecord });

    await expect(service.getMonthlyUsage('user-1', '2026-09')).resolves.toEqual(
      {
        month: '2026-09',
        uploadedMinutes: 2.5,
        clipCount: 3,
        aiRuns: 2,
        aiRunLimit: 3,
      },
    );
    expect(usageRecord.findUnique).toHaveBeenCalledWith({
      where: {
        userId_monthStart: {
          userId: 'user-1',
          monthStart: new Date('2026-09-01T00:00:00.000Z'),
        },
      },
      select: { uploadedSeconds: true, clipCount: true, aiRunCount: true },
    });
  });

  it('returns zero usage when the user has no record for the month', async () => {
    const service = createService({
      usageRecord: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.getMonthlyUsage('user-1', '2026-09')).resolves.toEqual(
      {
        month: '2026-09',
        uploadedMinutes: 0,
        clipCount: 0,
        aiRuns: 0,
        aiRunLimit: 3,
      },
    );
  });

  it('rejects invalid month values', async () => {
    const service = createService({});

    await expect(
      service.getMonthlyUsage('user-1', 'September'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UsageService.reserveAiRun', () => {
  it('increments the counter only while the user is below the monthly limit', async () => {
    const usageRecord = {
      upsert: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    await expect(
      createService({ usageRecord }, 5).reserveAiRun('user-1'),
    ).resolves.toBeUndefined();

    expect(usageRecord.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        monthStart: expect.any(Date) as Date,
        aiRunCount: { lt: 5 },
      },
      data: { aiRunCount: { increment: 1 } },
    });
  });

  it('rejects with 429 when the monthly limit has been reached', async () => {
    const usageRecord = {
      upsert: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };

    const result = createService({ usageRecord }, 5).reserveAiRun('user-1');

    await expect(result).rejects.toBeInstanceOf(HttpException);
    await expect(result).rejects.toMatchObject({
      status: 429,
      message: 'Monthly AI run limit of 5 has been reached',
    });
  });
});
