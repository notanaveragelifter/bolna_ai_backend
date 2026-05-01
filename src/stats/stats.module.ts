import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { SupabaseService } from '../common/supabase.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService, SupabaseService],
})
export class StatsModule {}
