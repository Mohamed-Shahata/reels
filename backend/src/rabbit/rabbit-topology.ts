import type { ConfirmChannel } from 'amqplib';
import { REELS_EXCHANGES, REELS_QUEUES, RETRY_TIERS } from './rabbit.constants';

export async function assertRabbitTopology(
  channel: ConfirmChannel,
): Promise<void> {
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
}
