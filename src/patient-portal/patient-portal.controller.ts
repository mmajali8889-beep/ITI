import { Controller, ForbiddenException, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthSession } from '../auth/auth.types';
import { PatientPortalService } from './patient-portal.service';
@Controller('api/patient-portal')
export class PatientPortalController {
  constructor(private readonly service: PatientPortalService) {}
  @Get(':patientId')
  get(@Param('patientId') patientId: string, @Query('hospitalId') hospitalId: string, @Req() request: Request & { auth?: AuthSession }) {
    const profile = request.auth?.profile;
    if (profile?.resourceType === 'Patient' && profile.id !== patientId) throw new ForbiddenException('Patients may access only their own portal');
    return this.service.get(patientId, hospitalId);
  }
}
