import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('bolna')
  @HttpCode(200)
  async handleBolna(@Body() payload: any) {
    await this.webhookService.handleBolnaWebhook(payload);
    return { ok: true };
  }
}
