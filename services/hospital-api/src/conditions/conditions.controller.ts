import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { ConditionsService } from './conditions.service';

import { CreateConditionDto } from './dto/create-condition.dto';

@Controller('api/conditions')
export class ConditionsController {
  constructor(private readonly conditionsService: ConditionsService) {}

  // =====================================================
  // CREATE CONDITION
  //
  // POST /api/conditions
  // =====================================================

  @Post()
  create(
    @Body()
    dto: CreateConditionDto,
  ) {
    return this.conditionsService.create(dto);
  }

  // =====================================================
  // ENCOUNTER CONDITIONS
  //
  // GET /api/conditions?encounterId=...
  // =====================================================

  @Get()
  findByEncounter(
    @Query('encounterId')
    encounterId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.conditionsService.findByEncounter(encounterId, hospitalId);
  }

  // =====================================================
  // PATIENT PROBLEM LIST
  //
  // GET /api/conditions/patient/:patientId
  // =====================================================

  @Get('patient/:patientId')
  findPatientProblems(
    @Param('patientId')
    patientId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.conditionsService.findPatientProblems(patientId, hospitalId);
  }

  // =====================================================
  // CONDITION BY ID
  //
  // GET /api/conditions/:conditionId
  // =====================================================

  @Get(':conditionId')
  findById(
    @Param('conditionId')
    conditionId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.conditionsService.findById(conditionId, hospitalId);
  }

  // =====================================================
  // UPDATE STATUS
  //
  // PATCH /api/conditions/:conditionId/status
  // =====================================================

  @Patch(':conditionId/status')
  updateStatus(
    @Param('conditionId')
    conditionId: string,

    @Body()
    body: {
      clinicalStatus: string;
      hospitalId: string;
    },
  ) {
    return this.conditionsService.updateStatus(
      conditionId,
      body.clinicalStatus,
      body.hospitalId,
    );
  }
}
