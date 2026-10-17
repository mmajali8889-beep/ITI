import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';

@Controller('api/patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  // =====================================================
  // Search / List Patients
  //
  // GET /api/patients
  // GET /api/patients?search=Ahmad
  // GET /api/patients?mrn=HA-000001
  // GET /api/patients?nationalId=1234567890
  // GET /api/patients?phone=0790000000
  // GET /api/patients?hospitalId=...
  // =====================================================

  @Get()
  findAll(
    @Query('hospitalId')
    hospitalId: string,

    @Query('search')
    search?: string,

    @Query('mrn')
    mrn?: string,

    @Query('nationalId')
    nationalId?: string,

    @Query('phone')
    phone?: string,

    @Query('passportNumber')
    passportNumber?: string,
  ) {
    return this.patientsService.findAll({
      search,
      mrn,
      nationalId,
      phone,
      passportNumber,
      hospitalId,
    });
  }

  // =====================================================
  // Create Patient
  //
  // POST /api/patients
  // =====================================================

  @Post()
  create(
    @Body()
    dto: CreatePatientDto,
  ) {
    return this.patientsService.create(dto);
  }

  @Get('registration/duplicates')
  checkRegistrationDuplicates(
    @Query('hospitalId') hospitalId: string,
    @Query('hospitalCode') hospitalCode: string,
    @Query('hospitalMrn') hospitalMrn?: string,
    @Query('nationalId') nationalId?: string,
    @Query('passportNumber') passportNumber?: string,
    @Query('phone') phone?: string,
  ) {
    return this.patientsService.checkRegistrationDuplicates({
      hospitalId,
      hospitalCode,
      hospitalMrn,
      nationalId,
      passportNumber,
      phone,
    });
  }

  // =====================================================
  // Get Patient By FHIR ID
  //
  // GET /api/patients/:patientId
  // =====================================================

  @Get(':patientId')
  findById(
    @Param('patientId')
    patientId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.patientsService.findById(patientId, hospitalId);
  }
}
