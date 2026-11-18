import { Global, Module } from '@nestjs/common';
import { OutboxRelayService } from './outbox-relay.service';
import { RabbitService } from './rabbit.service';

@Global()
@Module({
  providers: [RabbitService, OutboxRelayService],
  exports: [RabbitService, OutboxRelayService],
})
export class RabbitModule {}
