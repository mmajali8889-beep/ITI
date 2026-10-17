import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateImagingStudyDto } from './dto/create-imaging-study.dto';
import { UpdateImagingStudyStatusDto } from './dto/update-imaging-study-status.dto';
import { ImagingStudyService } from './imaging-study.service';

@Controller('api/radiology/imaging-studies')
export class ImagingStudyController {
  constructor(private readonly imagingStudyService: ImagingStudyService) {}

  @Post()
  create(@Body() dto: CreateImagingStudyDto) {
    return this.imagingStudyService.create(dto);
  }

  @Get(':studyId')
  getById(@Param('studyId') studyId: string) {
    return this.imagingStudyService.getById(studyId);
  }

  @Get('order/:orderId')
  getByOrder(@Param('orderId') orderId: string) {
    return this.imagingStudyService.getByOrder(orderId);
  }

  @Get('encounter/:encounterId')
  getByEncounter(@Param('encounterId') encounterId: string) {
    return this.imagingStudyService.getByEncounter(encounterId);
  }

  @Get('patient/:patientId')
  getByPatient(@Param('patientId') patientId: string) {
    return this.imagingStudyService.getByPatient(patientId);
  }

  @Patch(':studyId/status')
  updateStatus(@Param('studyId') studyId: string, @Body() dto: UpdateImagingStudyStatusDto) {
    return this.imagingStudyService.updateStatus(studyId, dto.status);
  }
}
