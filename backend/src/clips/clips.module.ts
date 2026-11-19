import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProcessingModule } from '../processing/processing.module';
import { StorageModule } from '../storage/storage.module';
import { SegmentationModule } from '../segmentation/segmentation.module';
import { UsageModule } from '../usage/usage.module';
import { RendersModule } from '../renders/renders.module';
import { AiClipRunsService } from './ai-clip-runs.service';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';

@Module({
  imports: [
    PrismaModule,
    ProcessingModule,
    StorageModule,
    SegmentationModule,
    UsageModule,
    RendersModule,
  ],
  controllers: [ClipsController],
  providers: [ClipsService, AiClipRunsService],
  exports: [ClipsService, AiClipRunsService],
})
export class ClipsModule {}
