import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ClipsModule } from './clips/clips.module';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { AppConfigModule } from './config/app-config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { ProcessingModule } from './processing/processing.module';
import { SegmentationModule } from './segmentation/segmentation.module';
import { UsageModule } from './usage/usage.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    StorageModule,
    HealthModule,
    AuthModule,
    VideosModule,
    ClipsModule,
    UsageModule,
    ProcessingModule.register(),
    SegmentationModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*path');
  }
}
