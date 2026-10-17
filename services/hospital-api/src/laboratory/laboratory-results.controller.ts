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

import { CreateLabResultDto } from './dto/create-lab-result.dto';
import { CreateLabResultsBatchDto } from './dto/create-lab-results-batch.dto';
import { UpdateLabResultDto } from './dto/update-lab-result.dto';
import { LaboratoryResultsService } from './laboratory-results.service';
import {
  AcknowledgeCriticalResultDto,
  ValidateLabResultDto,
} from './dto/lab-validation.dto';
import { Roles } from '../auth/roles.decorator';

@Controller('api/laboratory')
export class LaboratoryResultsController {
  constructor(
    private readonly laboratoryResultsService: LaboratoryResultsService,
  ) {}

  @Post('results')
  createResult(@Body() dto: CreateLabResultDto) {
    return this.laboratoryResultsService.createResult(dto);
  }

  @Post('results/batch')
  createResultsBatch(@Body() dto: CreateLabResultsBatchDto) {
    return this.laboratoryResultsService.createResultsBatch(dto);
  }

  @Get('orders/:orderId/results')
  findByOrder(
    @Param('orderId') orderId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.laboratoryResultsService.findByOrder(
      orderId,
      requireHospitalId(hospitalId),
    );
  }

  @Get('encounter/:encounterId/results')
  findByEncounter(
    @Param('encounterId') encounterId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.laboratoryResultsService.findByEncounter(
      encounterId,
      requireHospitalId(hospitalId),
    );
  }

  @Get('patient/:patientId/results')
  findByPatient(
    @Param('patientId') patientId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.laboratoryResultsService.findByPatient(
      patientId,
      requireHospitalId(hospitalId),
    );
  }

  @Get('results/:resultId')
  findResult(@Param('resultId') resultId: string) {
    return this.laboratoryResultsService.findResult(resultId);
  }

  @Patch('results/:resultId')
  updateResult(
    @Param('resultId') resultId: string,
    @Body() dto: UpdateLabResultDto,
  ) {
    return this.laboratoryResultsService.updateResult(resultId, dto);
  }

  @Post('results/:resultId/technical-validation')
  @Roles(
    'lab-technician',
    'lab-supervisor',
    'administrator',
    'system-administrator',
  )
  technicalValidation(
    @Param('resultId') resultId: string,
    @Body() dto: ValidateLabResultDto,
  ) {
    return this.laboratoryResultsService.validateTechnical(resultId, dto);
  }

  @Post('results/:resultId/clinical-validation')
  @Roles(
    'lab-supervisor',
    'consultant',
    'administrator',
    'system-administrator',
  )
  clinicalValidation(
    @Param('resultId') resultId: string,
    @Body() dto: ValidateLabResultDto,
  ) {
    return this.laboratoryResultsService.validateClinical(resultId, dto);
  }

  @Post('results/:resultId/critical-acknowledgement')
  @Roles(
    'lab-technician',
    'lab-supervisor',
    'doctor',
    'consultant',
    'nurse',
    'administrator',
    'system-administrator',
  )
  acknowledgeCritical(
    @Param('resultId') resultId: string,
    @Body() dto: AcknowledgeCriticalResultDto,
  ) {
    return this.laboratoryResultsService.acknowledgeCritical(resultId, dto);
  }
}

function requireHospitalId(hospitalId: string): string {
  if (!hospitalId?.trim())
    throw new BadRequestException('Hospital ID is required');
  return hospitalId;
}
