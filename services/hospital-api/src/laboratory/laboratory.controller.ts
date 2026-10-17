import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CreateSpecimenDto } from './dto/create-specimen.dto';
import { UpdateSpecimenStatusDto } from './dto/update-specimen-status.dto';
import { LaboratoryService } from './laboratory.service';
import { CreateLabOrderDto } from './dto/create-lab-order.dto';

@Controller('api/laboratory')
export class LaboratoryController {
  constructor(private readonly laboratoryService: LaboratoryService) {}

  @Post('orders')
  createOrder(@Body() dto: CreateLabOrderDto) {
    return this.laboratoryService.createOrder(dto);
  }

  @Get('encounter/:encounterId')
  findByEncounter(
    @Param('encounterId') encounterId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.laboratoryService.findByEncounter(
      encounterId,
      requireHospitalId(hospitalId),
    );
  }

  @Get('patient/:patientId')
  findByPatient(
    @Param('patientId') patientId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.laboratoryService.findByPatient(
      patientId,
      requireHospitalId(hospitalId),
    );
  }

  @Get('orders/:orderId')
  findOrder(@Param('orderId') orderId: string) {
    return this.laboratoryService.findOrder(orderId);
  }

  @Patch('orders/:orderId/status')
  updateStatus(
    @Param('orderId') orderId: string,
    @Body()
    body: {
      status:
        | 'draft'
        | 'active'
        | 'on-hold'
        | 'revoked'
        | 'completed'
        | 'entered-in-error';
      hospitalId: string;
    },
  ) {
    return this.laboratoryService.updateOrderStatus(
      orderId,
      body.status,
      requireHospitalId(body.hospitalId),
    );
  }

  @Post('specimens')
  createSpecimen(@Body() dto: CreateSpecimenDto) {
    return this.laboratoryService.createSpecimen(dto);
  }

  @Get('orders/:orderId/specimens')
  findSpecimensByOrder(
    @Param('orderId') orderId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.laboratoryService.findSpecimensByOrder(
      orderId,
      requireHospitalId(hospitalId),
    );
  }

  @Get('specimens/:specimenId')
  findSpecimen(@Param('specimenId') specimenId: string) {
    return this.laboratoryService.findSpecimen(specimenId);
  }

  @Patch('specimens/:specimenId/status')
  updateSpecimenStatus(
    @Param('specimenId') specimenId: string,
    @Body() dto: UpdateSpecimenStatusDto,
  ) {
    return this.laboratoryService.updateSpecimenStatus(specimenId, dto);
  }
}

function requireHospitalId(hospitalId: string): string {
  if (!hospitalId?.trim())
    throw new BadRequestException('Hospital ID is required');
  return hospitalId;
}
