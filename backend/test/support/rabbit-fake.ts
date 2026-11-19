import { Logger } from '@nestjs/common';
import type { MessageHandler } from '../../src/rabbit/rabbit.service';
import type { ConsumeMessage } from 'amqplib';

export interface PublishedMessage {
  exchange: string;
  routingKey: string;
  content: unknown;
  headers?: Record<string, unknown>;
  timestamp: Date;
}

export class RabbitFake {
  private readonly logger = new Logger(RabbitFake.name);
  public readonly published: PublishedMessage[] = [];
  public readonly consumers = new Map<string, MessageHandler<unknown>[]>();
  private connected = true;

  async onModuleInit(): Promise<void> {
    this.connected = true;
    this.logger.log('RabbitFake initialized');
  }

  async onModuleDestroy(): Promise<void> {
    this.connected = false;
    this.published.length = 0;
    this.consumers.clear();
    this.logger.log('RabbitFake destroyed');
  }

  isConnected(): boolean {
    return this.connected;
  }

  async checkHealth(): Promise<boolean> {
    return this.connected;
  }

  async inspectQueues(): Promise<{
    queues: { queue: string; isDlq: boolean; messageCount: number; consumerCount: number }[];
    totalDeadLetters: number;
    alert: boolean;
  }> {
    return {
      queues: [
        { queue: 'ingest', isDlq: false, messageCount: 0, consumerCount: 1 },
        { queue: 'ingest.dlq', isDlq: true, messageCount: 0, consumerCount: 0 },
      ],
      totalDeadLetters: 0,
      alert: false,
    };
  }

  async publish(
    exchange: string,
    routingKey: string,
    message: unknown,
    options?: { headers?: Record<string, unknown> },
  ): Promise<boolean> {
    if (!this.connected) return false;

    const record: PublishedMessage = {
      exchange,
      routingKey,
      content: message,
      headers: options?.headers,
      timestamp: new Date(),
    };
    this.published.push(record);

    // Deliver to matching consumers (direct queue = routingKey)
    const handlers = this.consumers.get(routingKey) || [];
    for (const handler of handlers) {
      const fakeMsg: ConsumeMessage = {
        content: Buffer.from(JSON.stringify(message)),
        fields: {
          deliveryTag: Date.now(),
          redelivered: false,
          exchange,
          routingKey,
          consumerTag: 'fake-consumer',
        },
        properties: {
          headers: options?.headers || {},
          contentType: 'application/json',
          contentEncoding: 'utf-8',
          deliveryMode: 2,
          priority: 0,
          correlationId: '',
          replyTo: '',
          expiration: '',
          messageId: `msg-${Date.now()}`,
          timestamp: Date.now(),
          type: '',
          userId: '',
          appId: '',
          clusterId: '',
        },
      };

      const ack = () => {};
      const nack = (_requeue?: boolean) => {};

      try {
        await handler(fakeMsg, message, ack, nack);
      } catch (err) {
        this.logger.error(
          `Handler error for routingKey ${routingKey}: ${(err as Error).message}`,
        );
      }
    }

    return true;
  }

  async consume<T = unknown>(
    queue: string,
    handler: MessageHandler<T>,
    _options?: { prefetch?: number },
  ): Promise<void> {
    const list = this.consumers.get(queue) || [];
    list.push(handler as MessageHandler<unknown>);
    this.consumers.set(queue, list);
  }

  async assertTopology(): Promise<void> {
    // No-op for in-memory fake
  }

  clear(): void {
    this.published.length = 0;
    this.consumers.clear();
  }
}

export function createRabbitFake(): RabbitFake {
  return new RabbitFake();
}
