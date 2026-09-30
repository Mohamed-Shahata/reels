import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubtitlesController } from './subtitles.controller';
import { SubtitlesService } from './subtitles.service';

@Module({
  imports: [PrismaModule],
  controllers: [SubtitlesController],
  providers: [SubtitlesService],
  exports: [SubtitlesService],
})
export class SubtitlesModule {}
