import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitService } from '../rabbit/rabbit.service';
import { S3StorageService } from '../storage/s3-storage.service';

export interface HealthServicesStatus {
  database: 'up' | 'down';
  rabbitmq: 'up' | 'down';
  storage: 'up' | 'down';
}

export interface HealthStatus {
  status: 'ok';
  database: 'up';
  services: HealthServicesStatus;
  uptimeSec: number;
  timestamp: string;
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
    private readonly s3: S3StorageService,
  ) {}

  @Public()
  @Get()
  async check(): Promise<HealthStatus> {
    // 1. Check Database
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error(
        'Database health check failed',
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Database is unreachable');
    }

    // 2. Check RabbitMQ
    const rabbitOk = await this.rabbit.checkHealth();
    if (!rabbitOk) {
      this.logger.error('RabbitMQ health check failed: broker disconnected');
      throw new ServiceUnavailableException('RabbitMQ is disconnected');
    }

    // 3. Check S3 Storage
    const s3Ok = await this.s3.checkHealth();
    if (!s3Ok) {
      this.logger.error('S3 storage health check failed');
      throw new ServiceUnavailableException('S3 storage is unreachable');
    }

    return {
      status: 'ok',
      database: 'up',
      services: {
        database: 'up',
        rabbitmq: 'up',
        storage: 'up',
      },
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
