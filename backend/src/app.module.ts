import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { AppConfigModule } from './config/app-config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    StorageModule,
    HealthModule,
    AuthModule,
    VideosModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*path');
  }
}
