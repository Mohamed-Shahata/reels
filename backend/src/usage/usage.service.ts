import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface MonthlyUsage {
  month: string;
  uploadedMinutes: number;
  clipCount: number;
}

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  async getMonthlyUsage(userId: string, month?: string): Promise<MonthlyUsage> {
    const monthStart = this.parseMonth(month);
    const record = await this.prisma.usageRecord.findUnique({
      where: { userId_monthStart: { userId, monthStart } },
      select: { uploadedSeconds: true, clipCount: true },
    });

    return {
      month: monthStart.toISOString().slice(0, 7),
      uploadedMinutes: (record?.uploadedSeconds ?? 0) / 60,
      clipCount: record?.clipCount ?? 0,
    };
  }

  private parseMonth(month?: string): Date {
    if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('month must use YYYY-MM format');
    }
    const source = month
      ? `${month}-01T00:00:00.000Z`
      : new Date().toISOString();
    const date = new Date(source);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
}
