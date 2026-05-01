import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { SupabaseService } from '../common/supabase.service';
import { DebtorsModule } from '../debtors/debtors.module';
import { BolnaService } from '../common/bolna.service';
import { TranscriptParserService } from '../common/transcript-parser.service';

@Module({
  imports: [DebtorsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, SupabaseService, BolnaService, TranscriptParserService],
})
export class CampaignsModule {}
