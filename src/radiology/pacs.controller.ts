import {
  Controller,
  Get,
  Param,
} from '@nestjs/common';

import { PacsService } from './pacs.service';

@Controller('api/radiology/pacs')
export class PacsController {
  constructor(
    private readonly pacsService:
      PacsService,
  ) {}

  @Get('status')
  status() {
    return this.pacsService
      .getSystemStatus();
  }

  @Get('studies')
  studies() {
    return this.pacsService
      .listStudies();
  }

  @Get('studies/uid/:studyInstanceUid')
  studyByUid(
    @Param('studyInstanceUid')
    studyInstanceUid: string,
  ) {
    return this.pacsService
      .findStudyByUid(
        studyInstanceUid,
      );
  }

  @Get('studies/:orthancStudyId')
  study(
    @Param('orthancStudyId')
    orthancStudyId: string,
  ) {
    return this.pacsService
      .getStudy(
        orthancStudyId,
      );
  }
}
