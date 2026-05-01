import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DebtorsModule } from './debtors/debtors.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { WebhookModule } from './webhook/webhook.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    DebtorsModule,
    CampaignsModule,
    WebhookModule,
    StatsModule,
  ],
})
export class AppModule {}
