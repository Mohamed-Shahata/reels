import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RabbitModule } from '../rabbit/rabbit.module';
import { StorageModule } from '../storage/storage.module';
import { HealthController } from './health.controller';
import { AdminQueuesController } from './admin-queues.controller';

@Module({
  imports: [PrismaModule, RabbitModule, StorageModule],
  controllers: [HealthController, AdminQueuesController],
})
export class HealthModule {}
