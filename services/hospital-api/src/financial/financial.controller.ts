import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AssignFinancialClassDto,
  CheckEligibilityDto,
  CreateCoverageDto,
  RecordEligibilityDecisionDto,
  UpdateCoverageStatusDto,
} from './dto/financial.dto';
import { FinancialService } from './financial.service';

@Controller('api/financial')
export class FinancialController {
  constructor(private readonly service: FinancialService) {}

  @Post('coverages')
  createCoverage(@Body() dto: CreateCoverageDto) {
    return this.service.createCoverage(dto);
  }

  @Get('coverages/patient/:patientId')
  patientCoverages(
    @Param('patientId') patientId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.service.patientCoverages(patientId, hospitalId);
  }

  @Patch('coverages/:coverageId/status')
  updateCoverageStatus(
    @Param('coverageId') coverageId: string,
    @Body() dto: UpdateCoverageStatusDto,
  ) {
    return this.service.updateCoverageStatus(coverageId, dto);
  }

  @Post('eligibility/checks')
  checkEligibility(@Body() dto: CheckEligibilityDto) {
    return this.service.checkEligibility(dto);
  }

  @Patch('eligibility/:requestId/decision')
  recordEligibilityDecision(
    @Param('requestId') requestId: string,
    @Body() dto: RecordEligibilityDecisionDto,
  ) {
    return this.service.recordEligibilityDecision(requestId, dto);
  }

  @Get('eligibility/patient/:patientId')
  eligibilityHistory(
    @Param('patientId') patientId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.service.eligibilityHistory(patientId, hospitalId);
  }

  @Post('encounters/:encounterId/classification')
  assignFinancialClass(
    @Param('encounterId') encounterId: string,
    @Body() dto: AssignFinancialClassDto,
  ) {
    return this.service.assignFinancialClass(encounterId, dto);
  }
}
