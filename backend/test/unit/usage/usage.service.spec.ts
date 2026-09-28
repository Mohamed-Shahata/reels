import { BadRequestException } from '@nestjs/common';
import { UsageService } from '../../../src/usage/usage.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';

describe('UsageService', () => {
  it('returns usage for the requested month and user', async () => {
    const usageRecord = {
      findUnique: jest.fn().mockResolvedValue({
        uploadedSeconds: 150,
        clipCount: 3,
      }),
    };
    const service = new UsageService({
      usageRecord,
    } as unknown as PrismaService);

    await expect(service.getMonthlyUsage('user-1', '2026-09')).resolves.toEqual(
      {
        month: '2026-09',
        uploadedMinutes: 2.5,
        clipCount: 3,
      },
    );
    expect(usageRecord.findUnique).toHaveBeenCalledWith({
      where: {
        userId_monthStart: {
          userId: 'user-1',
          monthStart: new Date('2026-09-01T00:00:00.000Z'),
        },
      },
      select: { uploadedSeconds: true, clipCount: true },
    });
  });

  it('returns zero usage when the user has no record for the month', async () => {
    const service = new UsageService({
      usageRecord: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService);

    await expect(service.getMonthlyUsage('user-1', '2026-09')).resolves.toEqual(
      {
        month: '2026-09',
        uploadedMinutes: 0,
        clipCount: 0,
      },
    );
  });

  it('rejects invalid month values', async () => {
    const service = new UsageService({} as PrismaService);

    await expect(
      service.getMonthlyUsage('user-1', 'September'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
