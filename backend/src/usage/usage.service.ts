import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';

export interface MonthlyUsage {
  month: string;
  uploadedMinutes: number;
  clipCount: number;
  aiRuns: number;
  aiRunLimit: number;
}

@Injectable()
export class UsageService {
  private readonly aiRunLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.aiRunLimit = config.get('SEGMENTATION_MONTHLY_RUN_LIMIT', {
      infer: true,
    });
  }

  async getMonthlyUsage(userId: string, month?: string): Promise<MonthlyUsage> {
    const monthStart = this.parseMonth(month);
    const record = await this.prisma.usageRecord.findUnique({
      where: { userId_monthStart: { userId, monthStart } },
      select: { uploadedSeconds: true, clipCount: true, aiRunCount: true },
    });

    return {
      month: monthStart.toISOString().slice(0, 7),
      uploadedMinutes: (record?.uploadedSeconds ?? 0) / 60,
      clipCount: record?.clipCount ?? 0,
      aiRuns: record?.aiRunCount ?? 0,
      aiRunLimit: this.aiRunLimit,
    };
  }

  async reserveAiRun(userId: string): Promise<void> {
    const monthStart = this.parseMonth();
    await this.prisma.usageRecord.upsert({
      where: { userId_monthStart: { userId, monthStart } },
      create: {
        userId,
        monthStart,
        uploadedSeconds: 0,
        clipCount: 0,
        aiRunCount: 0,
      },
      update: {},
    });

    const { count } = await this.prisma.usageRecord.updateMany({
      where: { userId, monthStart, aiRunCount: { lt: this.aiRunLimit } },
      data: { aiRunCount: { increment: 1 } },
    });

    if (count === 0) {
      throw new HttpException(
        `Monthly AI run limit of ${this.aiRunLimit} has been reached`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
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
