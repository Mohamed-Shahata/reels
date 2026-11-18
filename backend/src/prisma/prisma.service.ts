import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.schema';
import { PrismaClient } from '../generated/prisma/client';
import { ResilientPool } from './resilient-pool';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg(
        new ResilientPool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          // Fail fast on a stuck TLS handshake instead of hanging ~16s.
          connectionTimeoutMillis: 8_000,
          // Recycle idle sockets before Neon's pooler/proxy silently drops them.
          idleTimeoutMillis: 10_000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
          max: 10,
        }),
      ),
      transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
