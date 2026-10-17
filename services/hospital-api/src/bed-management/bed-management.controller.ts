import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BedManagementService } from './bed-management.service';
import { UpdateBedStateDto } from './dto/bed-management.dto';
@Controller('api/bed-management')
export class BedManagementController {
  constructor(private readonly service: BedManagementService) {}
  @Get('board') board(@Query('hospitalId') hospitalId: string) {
    return this.service.board(hospitalId);
  }
  @Post('beds/:id/state') state(
    @Param('id') id: string,
    @Body() dto: UpdateBedStateDto,
  ) {
    return this.service.updateState(id, dto);
  }
}
