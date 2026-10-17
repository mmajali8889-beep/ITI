import { Controller, Get, Param, Query } from '@nestjs/common';
import { PatientJourneyService } from './patient-journey.service';
@Controller('api/patient-journey')
export class PatientJourneyController {
  constructor(private readonly service: PatientJourneyService) {}
  @Get(':patientId/encounters/:encounterId') get(
    @Param('patientId') p: string,
    @Param('encounterId') e: string,
    @Query('hospitalId') h: string,
  ) {
    return this.service.get(p, e, h);
  }
}
