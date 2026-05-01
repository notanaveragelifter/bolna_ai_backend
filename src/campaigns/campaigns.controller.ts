import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { Campaign } from './campaign.types';
import { BearerAuthGuard } from '../common/auth.guard';

@UseGuards(BearerAuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  findAll(): Promise<Campaign[]> {
    return this.campaignsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Campaign> {
    return this.campaignsService.findOne(id);
  }

  @Post()
  create(@Body('name') name: string): Promise<Campaign> {
    return this.campaignsService.create(name);
  }

  @Post(':id/trigger')
  trigger(@Param('id') id: string) {
    return this.campaignsService.triggerCalls(id);
  }
}
