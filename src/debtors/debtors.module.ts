import { Module } from '@nestjs/common';
import { DebtorsController } from './debtors.controller';
import { DebtorsService } from './debtors.service';
import { SupabaseService } from '../common/supabase.service';

@Module({
  controllers: [DebtorsController],
  providers: [DebtorsService, SupabaseService],
  exports: [DebtorsService],
})
export class DebtorsModule {}
