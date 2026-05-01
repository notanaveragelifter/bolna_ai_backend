import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { SupabaseService } from '../common/supabase.service';
import { DebtorsModule } from '../debtors/debtors.module';

@Module({
  imports: [DebtorsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, SupabaseService],
})
export class CampaignsModule {}
