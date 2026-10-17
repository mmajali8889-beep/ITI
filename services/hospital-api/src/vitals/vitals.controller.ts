import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';

import { VitalsService } from './vitals.service';

import { CreateVitalsDto } from './dto/create-vitals.dto';

@Controller('api/vitals')
export class VitalsController {
  constructor(private readonly vitalsService: VitalsService) {}

  // =====================================================
  // CREATE VITAL SIGNS
  //
  // POST /api/vitals
  // =====================================================

  @Post()
  create(
    @Body()
    dto: CreateVitalsDto,
  ) {
    return this.vitalsService.create(dto);
  }

  // =====================================================
  // GET VITAL SIGNS
  //
  // Encounter:
  // GET /api/vitals?encounterId=...
  //
  // Patient:
  // GET /api/vitals?patientId=...
  // =====================================================

  @Get()
  findVitals(
    @Query('encounterId')
    encounterId?: string,

    @Query('patientId')
    patientId?: string,
  ) {
    if (encounterId) {
      return this.vitalsService.findByEncounter(encounterId);
    }

    if (patientId) {
      return this.vitalsService.findByPatient(patientId);
    }

    throw new BadRequestException('encounterId or patientId is required');
  }
}
