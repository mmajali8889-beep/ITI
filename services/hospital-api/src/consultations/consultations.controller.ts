import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  AcceptConsultationDto,
  CancelConsultationDto,
  CompleteConsultationDto,
  CreateConsultationDto,
} from './dto/consultation.dto';
import { ConsultationsService } from './consultations.service';
@Controller('api/consultations')
export class ConsultationsController {
  constructor(private readonly service: ConsultationsService) {}
  @Post() create(@Body() dto: CreateConsultationDto) {
    return this.service.create(dto);
  }
  @Get('queue') queue(
    @Query('hospitalId') hospitalId: string,
    @Query('specialty') specialty?: string,
    @Query('status') status?: string,
  ) {
    return this.service.queue(hospitalId, specialty, status);
  }
  @Post(':id/accept') accept(
    @Param('id') id: string,
    @Body() dto: AcceptConsultationDto,
  ) {
    return this.service.accept(id, dto);
  }
  @Post(':id/complete') complete(
    @Param('id') id: string,
    @Body() dto: CompleteConsultationDto,
  ) {
    return this.service.complete(id, dto);
  }
  @Post(':id/cancel') cancel(
    @Param('id') id: string,
    @Body() dto: CancelConsultationDto,
  ) {
    return this.service.cancel(id, dto);
  }
}
