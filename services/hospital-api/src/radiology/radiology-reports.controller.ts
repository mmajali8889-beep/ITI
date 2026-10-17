import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { CreateRadiologyReportDto } from './dto/create-radiology-report.dto';
import { FinalizeRadiologyReportDto } from './dto/finalize-radiology-report.dto';
import { UpdateRadiologyReportDto } from './dto/update-radiology-report.dto';
import { RadiologyReportsService } from './radiology-reports.service';

@Controller('api/radiology/reports')
export class RadiologyReportsController {
  constructor(
    private readonly radiologyReportsService: RadiologyReportsService,
  ) {}

  @Post()
  createReport(
    @Body() dto: CreateRadiologyReportDto,
  ) {
    return this.radiologyReportsService.createReport(dto);
  }

  @Get('order/:orderId')
  findByOrder(
    @Param('orderId') orderId: string,
  ) {
    return this.radiologyReportsService.findByOrder(orderId);
  }

  @Get('encounter/:encounterId')
  findByEncounter(
    @Param('encounterId') encounterId: string,
  ) {
    return this.radiologyReportsService.findByEncounter(encounterId);
  }

  @Get('patient/:patientId')
  findByPatient(
    @Param('patientId') patientId: string,
  ) {
    return this.radiologyReportsService.findByPatient(patientId);
  }

  @Get(':reportId')
  findReport(
    @Param('reportId') reportId: string,
  ) {
    return this.radiologyReportsService.findReport(reportId);
  }

  @Patch(':reportId')
  updateReport(
    @Param('reportId') reportId: string,
    @Body() dto: UpdateRadiologyReportDto,
  ) {
    return this.radiologyReportsService.updateReport(reportId, dto);
  }

  @Post(':reportId/finalize')
  finalizeReport(
    @Param('reportId') reportId: string,
    @Body() dto: FinalizeRadiologyReportDto,
  ) {
    return this.radiologyReportsService.finalizeReport(reportId, dto);
  }

  @Post(':reportId/amend')
  amendReport(
    @Param('reportId') reportId: string,
    @Body() dto: UpdateRadiologyReportDto,
  ) {
    return this.radiologyReportsService.amendReport(reportId, dto);
  }
}
