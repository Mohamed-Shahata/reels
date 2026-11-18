import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, {
  type AmqpConnectionManager,
  type ChannelWrapper,
} from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage, Options } from 'amqplib';
import type { Env } from '../config/env.schema';
import { REELS_EXCHANGES, REELS_QUEUES, RETRY_TIERS } from './rabbit.constants';

export type MessageHandler<T = unknown> = (
  msg: ConsumeMessage,
  parsed: T,
  ack: () => void,
  nack: (requeue?: boolean) => void,
) => Promise<void>;

@Injectable()
export class RabbitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitService.name);
  private connection: AmqpConnectionManager | null = null;
  private publishChannel: ChannelWrapper | null = null;
  private readonly consumerChannels: ChannelWrapper[] = [];

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    const url =
      this.config.get('RABBITMQ_URL', { infer: true }) ||
      'amqp://guest:guest@localhost:5672';

    this.connection = amqp.connect([url], {
      heartbeatIntervalInSeconds: 15,
      reconnectTimeInSeconds: 2,
    });

    this.connection.on('connect', () => {
      this.logger.log('Connected to RabbitMQ broker');
    });

    this.connection.on('disconnect', (params: { err?: Error }) => {
      this.logger.warn(
        `Disconnected from RabbitMQ broker: ${params.err?.message ?? 'Unknown reason'}`,
      );
    });

    this.publishChannel = this.connection.createChannel({
      json: true,
      setup: async (channel: ConfirmChannel) => {
        await this.assertTopology(channel);
      },
    });

    await this.publishChannel.waitForConnect();
    this.logger.log('RabbitMQ publish channel and topology confirmed ready');
  }

  async onModuleDestroy(): Promise<void> {
    for (const channel of this.consumerChannels) {
      try {
        await channel.close();
      } catch (err) {
        this.logger.warn(
          `Error closing consumer channel: ${(err as Error).message}`,
        );
      }
    }
    if (this.publishChannel) {
      try {
        await this.publishChannel.close();
      } catch (err) {
        this.logger.warn(
          `Error closing publish channel: ${(err as Error).message}`,
        );
      }
    }
    if (this.connection) {
      try {
        await this.connection.close();
      } catch (err) {
        this.logger.warn(
          `Error closing RabbitMQ connection: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log('RabbitMQ connection closed cleanly');
  }

  async assertTopology(channel: ConfirmChannel): Promise<void> {
    // 1. Assert Exchanges
    await channel.assertExchange(REELS_EXCHANGES.WORK, 'direct', {
      durable: true,
    });
    await channel.assertExchange(REELS_EXCHANGES.RETRY, 'direct', {
      durable: true,
    });
    await channel.assertExchange(REELS_EXCHANGES.DLX, 'direct', {
      durable: true,
    });

    // 2. Assert Queues per work type
    for (const q of REELS_QUEUES) {
      // Main work queue
      await channel.assertQueue(q, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': REELS_EXCHANGES.DLX,
          'x-dead-letter-routing-key': `${q}.dead`,
        },
      });
      await channel.bindQueue(q, REELS_EXCHANGES.WORK, q);

      // Retry queues per tier
      for (const tier of RETRY_TIERS) {
        const retryQueue = `${q}.retry.${tier.name}`;
        await channel.assertQueue(retryQueue, {
          durable: true,
          arguments: {
            'x-message-ttl': tier.ttlMs,
            'x-dead-letter-exchange': REELS_EXCHANGES.WORK,
            'x-dead-letter-routing-key': q,
          },
        });
        await channel.bindQueue(retryQueue, REELS_EXCHANGES.RETRY, retryQueue);
      }

      // Dead Letter Queue (DLQ)
      const dlq = `${q}.dlq`;
      await channel.assertQueue(dlq, { durable: true });
      await channel.bindQueue(dlq, REELS_EXCHANGES.DLX, `${q}.dead`);
    }

    this.logger.log('RabbitMQ topology asserted successfully');
  }

  async publish(
    exchange: string,
    routingKey: string,
    payload: unknown,
    options: Options.Publish = {},
  ): Promise<boolean> {
    if (!this.publishChannel) {
      throw new Error('RabbitMQ publish channel is not initialized');
    }

    const publishOptions: Options.Publish = {
      persistent: true,
      contentType: 'application/json',
      ...options,
    };

    return this.publishChannel.publish(
      exchange,
      routingKey,
      payload,
      publishOptions,
    );
  }

  async consume<T = unknown>(
    queue: string,
    handler: MessageHandler<T>,
    options: { prefetch?: number } = {},
  ): Promise<void> {
    if (!this.connection) {
      throw new Error('RabbitMQ connection is not initialized');
    }

    const prefetch = options.prefetch ?? 1;

    const consumerChannel = this.connection.createChannel({
      setup: async (channel: ConfirmChannel) => {
        await channel.prefetch(prefetch);
        await channel.consume(
          queue,
          (msg: ConsumeMessage | null) => {
            void (async () => {
              if (!msg) return;

              let parsed: T;
              try {
                parsed = JSON.parse(msg.content.toString('utf-8')) as T;
              } catch (err) {
                this.logger.error(
                  `Failed to parse message from queue ${queue}: ${(err as Error).message}`,
                );
                channel.nack(msg, false, false); // Send unparseable message to DLX/discard
                return;
              }

              const ack = () => channel.ack(msg);
              const nack = (requeue = false) =>
                channel.nack(msg, false, requeue);

              try {
                await handler(msg, parsed, ack, nack);
              } catch (err) {
                this.logger.error(
                  `Unhandled error in consumer for queue ${queue}: ${(err as Error).message}`,
                  (err as Error).stack,
                );
                nack(false);
              }
            })();
          },
          { noAck: false },
        );
      },
    });

    this.consumerChannels.push(consumerChannel);
    await consumerChannel.waitForConnect();
    this.logger.log(
      `Consumer registered for queue ${queue} (prefetch: ${prefetch})`,
    );
  }
}
