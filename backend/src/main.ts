import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX, configureApp } from './app.setup';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = app.get<ConfigService<Env, true>>(ConfigService).get('PORT', {
    infer: true,
  });

  await app.listen(port);
  Logger.log(`API listening on port ${port} at /${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
