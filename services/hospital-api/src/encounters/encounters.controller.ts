import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { EncountersService } from './encounters.service';

import { CreateEncounterDto } from './dto/create-encounter.dto';
import { FinishEncounterDto } from './dto/finish-encounter.dto';
import {
  AssignEmergencyBedDto,
  EmergencyQuickArrivalDto,
  EmergencyReassessmentDto,
} from './dto/emergency.dto';

@Controller('api/encounters')
export class EncountersController {
  constructor(private readonly encountersService: EncountersService) {}

  @Post()
  create(
    @Body()
    dto: CreateEncounterDto,
  ) {
    return this.encountersService.create(dto);
  }

  @Get()
  findByPatient(
    @Query('patientId')
    patientId: string,

    @Query('hospitalId')
    hospitalId?: string,
  ) {
    return this.encountersService.findByPatient(patientId, hospitalId);
  }

  @Get('emergency/board')
  emergencyBoard(
    @Query('hospitalId') hospitalId: string,
    @Query('status') status?: string,
  ) {
    return this.encountersService.listEmergency(hospitalId, status);
  }

  @Post('emergency/quick-arrival')
  quickArrival(@Body() dto: EmergencyQuickArrivalDto) {
    return this.encountersService.emergencyQuickArrival(dto);
  }

  @Patch('emergency/:encounterId/bed')
  assignEmergencyBed(
    @Param('encounterId') encounterId: string,
    @Body() dto: AssignEmergencyBedDto,
  ) {
    return this.encountersService.assignEmergencyBed(encounterId, dto);
  }

  @Post('emergency/:encounterId/reassessments')
  reassessEmergency(
    @Param('encounterId') encounterId: string,
    @Body() dto: EmergencyReassessmentDto,
  ) {
    return this.encountersService.reassessEmergency(encounterId, dto);
  }

  @Get(':encounterId')
  findById(
    @Param('encounterId')
    encounterId: string,

    @Query('hospitalId') hospitalId: string,
  ) {
    return this.encountersService.findById(encounterId, hospitalId);
  }

  @Patch(':encounterId/finish')
  finish(
    @Param('encounterId')
    encounterId: string,

    @Body() dto: FinishEncounterDto,
  ) {
    return this.encountersService.finish(encounterId, dto);
  }
}
