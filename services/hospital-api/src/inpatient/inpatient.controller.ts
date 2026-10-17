import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InpatientService } from './inpatient.service';
import {
  AssignBedDto,
  CreateAdmissionRequestDto,
  CreateBedDto,
  CreateBedRequestDto,
  RecordAdmissionAuthorizationDto,
  ReviewAdmissionRequestDto,
  TransferBedDto,
} from './dto/inpatient.dto';

@Controller('api/inpatient')
export class InpatientController {
  constructor(private readonly service: InpatientService) {}
  @Get('census') census(@Query('hospitalId') hospitalId: string) {
    return this.service.census(hospitalId);
  }
  @Post('admission-requests') requestAdmission(
    @Body() dto: CreateAdmissionRequestDto,
  ) {
    return this.service.requestAdmission(dto);
  }
  @Post('admission-requests/:id/review') reviewAdmission(
    @Param('id') id: string,
    @Body() dto: ReviewAdmissionRequestDto,
  ) {
    return this.service.reviewAdmission(id, dto);
  }
  @Post('admission-requests/:id/authorization') authorizeAdmission(
    @Param('id') id: string,
    @Body() dto: RecordAdmissionAuthorizationDto,
  ) {
    return this.service.authorizeAdmission(id, dto);
  }
  @Post('admission-requests/:id/bed-request') requestBed(
    @Param('id') id: string,
    @Body() dto: CreateBedRequestDto,
  ) {
    return this.service.requestBed(id, dto);
  }
  @Post('beds') createBed(@Body() dto: CreateBedDto) {
    return this.service.createBed(dto);
  }
  @Post('admit') admit(@Body() dto: AssignBedDto) {
    return this.service.admit(dto);
  }
  @Post('transfer') transfer(@Body() dto: TransferBedDto) {
    return this.service.transfer(dto);
  }
}
