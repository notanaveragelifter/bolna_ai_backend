import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { SupabaseService } from '../common/supabase.service';
import { DebtorsModule } from '../debtors/debtors.module';
import { TranscriptParserService } from '../common/transcript-parser.service';
import { BolnaService } from '../common/bolna.service';

@Module({
  imports: [DebtorsModule],
  controllers: [WebhookController],
  providers: [WebhookService, SupabaseService, TranscriptParserService, BolnaService],
})
export class WebhookModule {}
