import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import {
  RadiologyMwlService,
} from './radiology-mwl.service';

import {
  PublishRadiologyWorklistDto,
} from './dto/publish-radiology-worklist.dto';

@Controller('api/radiology/mwl')
export class RadiologyMwlController {
  constructor(
    private readonly mwlService:
      RadiologyMwlService,
  ) {}

  @Get('status')
  getStatus() {
    return this.mwlService
      .getStatus();
  }

  @Get('worklists')
  listWorklists(
    @Query('format')
    format?: string,
  ) {
    return this.mwlService
      .listWorklists(
        format || 'Short',
      );
  }

  @Get('orders/:orderId')
  getOrderWorklist(
    @Param('orderId')
    orderId: string,
  ) {
    return this.mwlService
      .getOrderWorklist(
        orderId,
      );
  }

  @Post('orders/:orderId/publish')
  publishOrder(
    @Param('orderId')
    orderId: string,

    @Body()
    dto:
      PublishRadiologyWorklistDto,
  ) {
    return this.mwlService
      .publishOrder(
        orderId,
        dto || {},
      );
  }

  @Delete('worklists/:worklistId')
  deleteWorklist(
    @Param('worklistId')
    worklistId: string,
  ) {
    return this.mwlService
      .deleteWorklist(
        worklistId,
      );
  }
}
