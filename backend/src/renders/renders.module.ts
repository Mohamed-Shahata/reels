import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProcessingModule } from '../processing/processing.module';
import { StorageModule } from '../storage/storage.module';
import { SubtitlesModule } from '../subtitles/subtitles.module';
import { FfmpegRenderService } from './ffmpeg-render.service';
import { RendersController } from './renders.controller';
import { RendersService } from './renders.service';

@Module({
  imports: [PrismaModule, StorageModule, SubtitlesModule, ProcessingModule],
  controllers: [RendersController],
  providers: [RendersService, FfmpegRenderService],
  exports: [FfmpegRenderService, RendersService],
})
export class RendersModule {}
