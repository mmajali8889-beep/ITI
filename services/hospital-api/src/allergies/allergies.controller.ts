import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { AllergiesService } from './allergies.service';

import { CreateAllergyDto } from './dto/create-allergy.dto';

@Controller('api/allergies')
export class AllergiesController {
  constructor(private readonly allergiesService: AllergiesService) {}

  // =====================================================
  // CREATE ALLERGY
  // POST /api/allergies
  // =====================================================

  @Post()
  create(
    @Body()
    dto: CreateAllergyDto,
  ) {
    return this.allergiesService.create(dto);
  }

  // =====================================================
  // GET PATIENT ALLERGIES
  // GET /api/allergies/patient/:patientId
  // =====================================================

  @Get('patient/:patientId')
  findByPatient(
    @Param('patientId')
    patientId: string,
  ) {
    return this.allergiesService.findByPatient(patientId);
  }

  // =====================================================
  // GET ALLERGY BY ID
  // GET /api/allergies/:allergyId
  // =====================================================

  @Get(':allergyId')
  findById(
    @Param('allergyId')
    allergyId: string,
  ) {
    return this.allergiesService.findById(allergyId);
  }

  // =====================================================
  // UPDATE CLINICAL STATUS
  // PATCH /api/allergies/:allergyId/status
  // =====================================================

  @Patch(':allergyId/status')
  updateStatus(
    @Param('allergyId')
    allergyId: string,

    @Body()
    body: {
      clinicalStatus: string;
    },
  ) {
    return this.allergiesService.updateStatus(allergyId, body.clinicalStatus);
  }
}
