import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SubtitlesModule } from '../subtitles/subtitles.module';
import { FfmpegRenderService } from './ffmpeg-render.service';
import { RendersController } from './renders.controller';
import { RendersService } from './renders.service';

@Module({
  imports: [PrismaModule, StorageModule, SubtitlesModule],
  controllers: [RendersController],
  providers: [RendersService, FfmpegRenderService],
  exports: [FfmpegRenderService, RendersService],
})
export class RendersModule {}
