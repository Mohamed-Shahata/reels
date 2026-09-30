import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SubtitlesModule } from '../subtitles/subtitles.module';
import { ClipRenderExecutorService } from './clip-render-executor.service';
import { RendersController } from './renders.controller';
import { RendersService } from './renders.service';

@Module({
  imports: [PrismaModule, StorageModule, SubtitlesModule],
  controllers: [RendersController],
  providers: [RendersService, ClipRenderExecutorService],
  exports: [ClipRenderExecutorService],
})
export class RendersModule {}
