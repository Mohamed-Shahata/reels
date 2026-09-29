import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SegmentationModule } from '../segmentation/segmentation.module';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';

@Module({
  imports: [PrismaModule, StorageModule, SegmentationModule],
  controllers: [ClipsController],
  providers: [ClipsService],
})
export class ClipsModule {}
