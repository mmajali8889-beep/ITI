import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NursingService } from './nursing.service';
import {
  CompleteNursingTaskDto,
  CreateCarePlanDto,
  CreateNursingNoteDto,
  CreateNursingTaskDto,
  NursingAdmissionAssessmentDto,
  RecordNursingObservationDto,
} from './dto/nursing.dto';
@Controller('api/nursing')
export class NursingController {
  constructor(private readonly service: NursingService) {}
  @Get('dashboard') dashboard(
    @Query('hospitalId') hospitalId: string,
    @Query('wardCode') wardCode?: string,
  ) {
    return this.service.dashboard(hospitalId, wardCode);
  }
  @Post('admission-assessments') assessment(
    @Body() dto: NursingAdmissionAssessmentDto,
  ) {
    return this.service.admissionAssessment(dto);
  }
  @Post('care-plans') carePlan(@Body() dto: CreateCarePlanDto) {
    return this.service.createCarePlan(dto);
  }
  @Post('observations') observation(@Body() dto: RecordNursingObservationDto) {
    return this.service.recordObservation(dto);
  }
  @Post('notes') note(@Body() dto: CreateNursingNoteDto) {
    return this.service.createNote(dto);
  }
  @Post('tasks') task(@Body() dto: CreateNursingTaskDto) {
    return this.service.createTask(dto);
  }
  @Post('tasks/:id/complete') complete(
    @Param('id') id: string,
    @Body() dto: CompleteNursingTaskDto,
  ) {
    return this.service.completeTask(id, dto);
  }
}
