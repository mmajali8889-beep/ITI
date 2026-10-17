import {
  Body,
  Controller,
  Param,
  Post,
} from '@nestjs/common';

import {
  SyncPacsStudyDto,
} from './dto/sync-pacs-study.dto';

import {
  PacsSyncService,
} from './pacs-sync.service';

@Controller('api/radiology/pacs/sync')
export class PacsSyncController {
  constructor(
    private readonly pacsSyncService:
      PacsSyncService,
  ) {}

  @Post('study/:studyInstanceUid')
  syncStudy(
    @Param('studyInstanceUid')
    studyInstanceUid: string,

    @Body()
    dto: SyncPacsStudyDto,
  ) {
    return this.pacsSyncService
      .syncByStudyInstanceUid(
        studyInstanceUid,
        dto,
      );
  }

  @Post('accession/:accessionNumber')
  syncAccession(
    @Param('accessionNumber')
    accessionNumber: string,
  ) {
    return this.pacsSyncService
      .syncByAccessionNumber(
        accessionNumber,
      );
  }

  @Post('scan')
  scanPacs() {
    return this.pacsSyncService
      .syncAvailableStudies();
  }

  @Post('patient/:patientId/hospital/:hospitalId')
  syncPatient(
    @Param('patientId')
    patientId: string,

    @Param('hospitalId')
    hospitalId: string,
  ) {
    return this.pacsSyncService
      .syncAllForPatient(
        patientId,
        hospitalId,
      );
  }
}
