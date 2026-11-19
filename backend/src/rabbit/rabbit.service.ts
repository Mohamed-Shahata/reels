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
import { REELS_EXCHANGES, REELS_QUEUES } from './rabbit.constants';
import { assertRabbitTopology } from './rabbit-topology';

export type MessageHandler<T = unknown> = (
  msg: ConsumeMessage,
  parsed: T,
  ack: () => void,
  nack: (requeue?: boolean) => void,
) => Promise<void>;

export interface QueueInspection {
  queue: string;
  isDlq: boolean;
  messageCount: number;
  consumerCount: number;
}

export interface QueuesReport {
  queues: QueueInspection[];
  totalDeadLetters: number;
  alert: boolean;
}

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
    await assertRabbitTopology(channel);
    this.logger.log('RabbitMQ topology asserted successfully');
  }

  isConnected(): boolean {
    return this.connection?.isConnected() ?? false;
  }

  async checkHealth(): Promise<boolean> {
    return this.isConnected();
  }

  async inspectQueues(): Promise<QueuesReport> {
    const inspections: QueueInspection[] = [];
    let totalDeadLetters = 0;

    if (!this.publishChannel) {
      return { queues: [], totalDeadLetters: 0, alert: false };
    }

    for (const q of REELS_QUEUES) {
      try {
        const info = await this.publishChannel.checkQueue(q);
        inspections.push({
          queue: q,
          isDlq: false,
          messageCount: info.messageCount,
          consumerCount: info.consumerCount,
        });
      } catch (err) {
        this.logger.warn(`Could not check queue ${q}: ${(err as Error).message}`);
      }

      const dlq = `${q}.dlq`;
      try {
        const dlqInfo = await this.publishChannel.checkQueue(dlq);
        inspections.push({
          queue: dlq,
          isDlq: true,
          messageCount: dlqInfo.messageCount,
          consumerCount: dlqInfo.consumerCount,
        });
        totalDeadLetters += dlqInfo.messageCount;
      } catch (err) {
        this.logger.warn(`Could not check DLQ ${dlq}: ${(err as Error).message}`);
      }
    }

    const alert = totalDeadLetters > 0;
    if (alert) {
      this.logger.warn(
        `[DLQ_ALERT] Dead letter queue has pending messages! Total: ${totalDeadLetters}`,
      );
    }

    return { queues: inspections, totalDeadLetters, alert };
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
      json: true,
      setup: async (channel: ConfirmChannel) => {
        await channel.prefetch(prefetch);
        await channel.consume(
          queue,
          (msg) => {
            if (!msg) return;
            void (async () => {
              let parsed: T;
              try {
                parsed = JSON.parse(msg.content.toString('utf-8')) as T;
              } catch {
                parsed = msg.content as unknown as T;
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
