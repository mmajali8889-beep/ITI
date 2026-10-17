import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClinicalServicesService } from './clinical-services.service';
import {
  CreateClinicalServiceOrderDto,
  UpdateClinicalServiceStatusDto,
} from './dto/clinical-service.dto';

@Controller('api/clinical-services')
export class ClinicalServicesController {
  constructor(private readonly service: ClinicalServicesService) {}

  @Post('orders')
  create(@Body() dto: CreateClinicalServiceOrderDto) {
    return this.service.create(dto);
  }

  @Get('encounter/:encounterId')
  byEncounter(
    @Param('encounterId') encounterId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.service.byEncounter(encounterId, hospitalId);
  }

  @Get('patient/:patientId')
  byPatient(
    @Param('patientId') patientId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.service.byPatient(patientId, hospitalId);
  }

  @Patch('orders/:orderId/status')
  updateStatus(
    @Param('orderId') orderId: string,
    @Body() dto: UpdateClinicalServiceStatusDto,
  ) {
    return this.service.updateStatus(orderId, dto);
  }
}
