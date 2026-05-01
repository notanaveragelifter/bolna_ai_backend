import { Controller, Get, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { BearerAuthGuard } from '../common/auth.guard';

@UseGuards(BearerAuthGuard)
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  getStats() {
    return this.statsService.getStats();
  }
}
