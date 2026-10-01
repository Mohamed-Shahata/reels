import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SegmentationModule } from '../segmentation/segmentation.module';
import { UsageModule } from '../usage/usage.module';
import { AiClipRunsService } from './ai-clip-runs.service';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';

@Module({
  imports: [PrismaModule, StorageModule, SegmentationModule, UsageModule],
  controllers: [ClipsController],
  providers: [ClipsService, AiClipRunsService],
  exports: [AiClipRunsService],
})
export class ClipsModule {}
