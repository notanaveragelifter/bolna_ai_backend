import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { BolnaService } from '../common/bolna.service';
import { BearerAuthGuard } from '../common/auth.guard';

@UseGuards(BearerAuthGuard)
@Controller('stats')
export class StatsController {
  constructor(
    private readonly statsService: StatsService,
    private readonly bolnaService: BolnaService,
  ) {}

  @Get()
  getStats() {
    return this.statsService.getStats();
  }

  /** Fetch all executions from Bolna dashboard */
  @Get('executions')
  getExecutions(@Query('status') status?: string) {
    return this.bolnaService.getAllExecutions(status);
  }

  /** Fetch a single execution detail */
  @Get('executions/:executionId')
  getExecution(@Param('executionId') executionId: string) {
    return this.bolnaService.getExecution(executionId);
  }
}
