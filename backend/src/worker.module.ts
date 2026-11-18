import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RabbitModule } from './rabbit/rabbit.module';
import { JobsModule } from './jobs/jobs.module';
import { StorageModule } from './storage/storage.module';
import { ProcessingModule } from './processing/processing.module';
import { TranscriptionModule } from './transcription/transcription.module';
import { ClipsModule } from './clips/clips.module';
import { RendersModule } from './renders/renders.module';
import { CleanupConsumer } from './jobs/consumers/cleanup.consumer';
import { IngestConsumer } from './jobs/consumers/ingest.consumer';
import { TranscribeConsumer } from './jobs/consumers/transcribe.consumer';
import { SegmentConsumer } from './jobs/consumers/segment.consumer';
import { AnalyzeConsumer } from './jobs/consumers/analyze.consumer';
import { RenderConsumer } from './jobs/consumers/render.consumer';
import { MaintenanceService } from './jobs/maintenance/maintenance.service';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    StorageModule,
    RabbitModule,
    JobsModule,
    ProcessingModule,
    TranscriptionModule,
    ClipsModule,
    RendersModule,
  ],
  providers: [
    CleanupConsumer,
    IngestConsumer,
    TranscribeConsumer,
    SegmentConsumer,
    AnalyzeConsumer,
    RenderConsumer,
    MaintenanceService,
  ],
})
export class WorkerModule {}
