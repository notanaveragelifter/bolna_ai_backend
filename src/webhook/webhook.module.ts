import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { SupabaseService } from '../common/supabase.service';
import { DebtorsModule } from '../debtors/debtors.module';

@Module({
  imports: [DebtorsModule],
  controllers: [WebhookController],
  providers: [WebhookService, SupabaseService],
})
export class WebhookModule {}
