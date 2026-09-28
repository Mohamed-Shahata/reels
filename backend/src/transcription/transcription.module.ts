import { Module } from '@nestjs/common';
import { TranscriptionService } from './transcription.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [TranscriptionService],
  exports: [TranscriptionService],
})
export class TranscriptionModule {}
