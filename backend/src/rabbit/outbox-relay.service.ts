import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { REELS_EXCHANGES } from './rabbit.constants';
import { RabbitService } from './rabbit.service';

interface OutboxRow {
  id: string;
  routingKey: string;
  payload: unknown;
  attempts: number;
}

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
  ) {}

  onModuleInit(): void {
    this.isRunning = true;
    this.timer = setInterval(() => {
      void this.relayBatch();
    }, 1000);
    this.logger.log('OutboxRelayService started (polling every 1s)');
  }

  async onModuleDestroy(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Wait briefly if a batch is currently executing
    let waited = 0;
    while (this.isProcessing && waited < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      waited += 100;
    }
    this.logger.log('OutboxRelayService stopped');
  }

  async relayBatch(): Promise<number> {
    if (!this.isRunning || this.isProcessing) {
      return 0;
    }

    this.isProcessing = true;
    let publishedCount = 0;

    try {
      // Find up to 50 pending events and lock them
      const events = await this.prisma.$transaction(async (tx) => {
        return tx.$queryRaw<OutboxRow[]>`
          SELECT "id", "routingKey", "payload", "attempts"
          FROM "OutboxEvent"
          WHERE "publishedAt" IS NULL
          ORDER BY "createdAt" ASC
          LIMIT 50
          FOR UPDATE SKIP LOCKED
        `;
      });

      if (!events || events.length === 0) {
        return 0;
      }

      for (const event of events) {
        try {
          await this.rabbit.publish(
            REELS_EXCHANGES.WORK,
            event.routingKey,
            event.payload,
          );

          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              publishedAt: new Date(),
              attempts: { increment: 1 },
            },
          });

          publishedCount++;
          this.logger.debug(
            `Published outbox event ${event.id} to ${REELS_EXCHANGES.WORK} (rk: ${event.routingKey})`,
          );
        } catch (publishErr) {
          this.logger.warn(
            `Failed to publish outbox event ${event.id}: ${(publishErr as Error).message}`,
          );
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: { increment: 1 },
            },
          });
        }
      }
    } catch (err) {
      this.logger.error(
        `Error during outbox relay batch: ${(err as Error).message}`,
      );
    } finally {
      this.isProcessing = false;
    }

    return publishedCount;
  }
}
