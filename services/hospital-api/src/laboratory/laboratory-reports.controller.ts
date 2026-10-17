import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { CreateLabReportDto } from './dto/create-lab-report.dto';
import { FinalizeLabReportDto } from './dto/finalize-lab-report.dto';
import { LaboratoryReportsService } from './laboratory-reports.service';
import { Roles } from '../auth/roles.decorator';

@Controller('api/laboratory/reports')
export class LaboratoryReportsController {
  constructor(
    private readonly laboratoryReportsService:
      LaboratoryReportsService,
  ) {}

  @Post()
  createReport(
    @Body() dto: CreateLabReportDto,
  ) {
    return this.laboratoryReportsService.createReport(dto);
  }

  @Get('order/:orderId')
  findByOrder(
    @Param('orderId') orderId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.laboratoryReportsService.findByOrder(orderId, requireHospitalId(hospitalId));
  }

  @Get('encounter/:encounterId')
  findByEncounter(
    @Param('encounterId') encounterId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.laboratoryReportsService.findByEncounter(
      encounterId, requireHospitalId(hospitalId),
    );
  }

  @Get('patient/:patientId')
  findByPatient(
    @Param('patientId') patientId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.laboratoryReportsService.findByPatient(
      patientId, requireHospitalId(hospitalId),
    );
  }

  @Get(':reportId')
  findReport(
    @Param('reportId') reportId: string,
  ) {
    return this.laboratoryReportsService.findReport(reportId);
  }

  @Post(':reportId/finalize')
  @Roles('lab-supervisor', 'consultant', 'administrator', 'system-administrator')
  finalizeReport(
    @Param('reportId') reportId: string,
    @Body() dto: FinalizeLabReportDto,
  ) {
    return this.laboratoryReportsService.finalizeReport(
      reportId,
      dto,
    );
  }

  @Post(':reportId/amend')
  @Roles('lab-supervisor', 'consultant', 'administrator', 'system-administrator')
  amendReport(
    @Param('reportId') reportId: string,
    @Body() dto: FinalizeLabReportDto,
  ) {
    return this.laboratoryReportsService.amendReport(
      reportId,
      dto,
    );
  }
}

function requireHospitalId(hospitalId: string): string {
  if (!hospitalId?.trim()) throw new BadRequestException('Hospital ID is required');
  return hospitalId;
}
