import { Module } from '@nestjs/common';
import { BoundaryReconciliationService } from './boundary-reconciliation.service';
import { BoundarySnappingService } from './boundary-snapping.service';
import { TopicSegmentValidationService } from './topic-segment-validation.service';
import { TopicSegmentationService } from './topic-segmentation.service';
import { TranscriptWindowingService } from './transcript-windowing.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    TranscriptWindowingService,
    BoundaryReconciliationService,
    BoundarySnappingService,
    TopicSegmentValidationService,
    TopicSegmentationService,
  ],
  exports: [
    TranscriptWindowingService,
    BoundaryReconciliationService,
    BoundarySnappingService,
    TopicSegmentValidationService,
    TopicSegmentationService,
  ],
})
export class SegmentationModule {}
