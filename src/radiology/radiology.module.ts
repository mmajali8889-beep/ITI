import {
  Module,
} from '@nestjs/common';

import {
  MedplumModule,
} from '../medplum/medplum.module';

import {
  ImagingStudyController,
} from './imaging-study.controller';

import {
  ImagingStudyService,
} from './imaging-study.service';

import {
  PacsController,
} from './pacs.controller';

import {
  PacsService,
} from './pacs.service';

import {
  PacsSyncController,
} from './pacs-sync.controller';

import {
  PacsSyncService,
} from './pacs-sync.service';

import {
  RadiologyController,
} from './radiology.controller';

import {
  RadiologyMwlController,
} from './radiology-mwl.controller';

import {
  RadiologyMwlService,
} from './radiology-mwl.service';

import {
  RadiologyReportsController,
} from './radiology-reports.controller';

import {
  RadiologyReportsService,
} from './radiology-reports.service';

import {
  RadiologyService,
} from './radiology.service';

import {
  RadiologyStationsController,
} from './radiology-stations.controller';

import {
  RadiologyStationsService,
} from './radiology-stations.service';

import {
  OrthancModalityRegistryService,
} from './orthanc-modality-registry.service';

import {
  RadiologistsController,
} from './radiologists.controller';

import {
  RadiologistsService,
} from './radiologists.service';

@Module({
  imports: [
    MedplumModule,
  ],

  controllers: [
    RadiologyController,
    RadiologyReportsController,
    ImagingStudyController,
    PacsController,
    PacsSyncController,
    RadiologyMwlController,
    RadiologyStationsController,
    RadiologistsController,
  ],

  providers: [
    RadiologyService,
    RadiologyReportsService,
    ImagingStudyService,
    PacsService,
    PacsSyncService,
    RadiologyMwlService,
    RadiologyStationsService,
    OrthancModalityRegistryService,
    RadiologistsService,
  ],

  exports: [
    RadiologyService,
    RadiologyReportsService,
    ImagingStudyService,
    PacsService,
    PacsSyncService,
    RadiologyMwlService,
    RadiologyStationsService,
    OrthancModalityRegistryService,
    RadiologistsService,
  ],
})
export class RadiologyModule {}
