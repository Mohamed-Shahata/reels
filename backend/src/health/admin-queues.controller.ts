import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { RabbitService, type QueuesReport } from '../rabbit/rabbit.service';

@Controller('admin/queues')
export class AdminQueuesController {
  constructor(private readonly rabbit: RabbitService) {}

  @Public()
  @Get()
  async getQueuesStatus(): Promise<QueuesReport> {
    return this.rabbit.inspectQueues();
  }
}
