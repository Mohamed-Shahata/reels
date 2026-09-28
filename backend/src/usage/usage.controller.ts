import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { UsageService } from './usage.service';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  getMonthlyUsage(
    @CurrentUser() auth: AuthContext,
    @Query('month') month?: string,
  ) {
    return this.usage.getMonthlyUsage(auth.userId, month);
  }
}
