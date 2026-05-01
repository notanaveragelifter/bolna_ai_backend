import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { SupabaseService } from '../common/supabase.service';
import { BolnaService } from '../common/bolna.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService, SupabaseService, BolnaService],
})
export class StatsModule {}
