import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [VideosController],
  providers: [VideosService],
})
export class VideosModule {}
