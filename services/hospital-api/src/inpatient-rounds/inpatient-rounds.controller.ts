import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateInpatientRoundDto } from './dto/inpatient-round.dto';
import { InpatientRoundsService } from './inpatient-rounds.service';
@Controller('api/inpatient-rounds')
export class InpatientRoundsController {
  constructor(private readonly service: InpatientRoundsService) {}
  @Get('patients') patients(
    @Query('hospitalId') hospitalId: string,
    @Query('wardCode') wardCode?: string,
  ) {
    return this.service.patientList(hospitalId, wardCode);
  }
  @Get(':encounterId/timeline') timeline(
    @Param('encounterId') encounterId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.service.timeline(encounterId, hospitalId);
  }
  @Post() create(@Body() dto: CreateInpatientRoundDto) {
    return this.service.createRound(dto);
  }
}
