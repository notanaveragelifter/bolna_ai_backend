import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DebtorsService } from './debtors.service';
import { BearerAuthGuard } from '../common/auth.guard';

@UseGuards(BearerAuthGuard)
@Controller('debtors')
export class DebtorsController {
  constructor(private readonly debtorsService: DebtorsService) {}

  @Get()
  findAll(@Query('campaign_id') campaignId?: string) {
    return this.debtorsService.findAll(campaignId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.debtorsService.findOne(id);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage() }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('campaign_id') campaignIdQuery?: string,
    @Body('campaign_id') campaignIdBody?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    const campaignId = campaignIdQuery ?? campaignIdBody;
    return this.debtorsService.uploadCsv(file.buffer, campaignId);
  }
}
