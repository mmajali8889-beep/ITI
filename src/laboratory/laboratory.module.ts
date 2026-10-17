import { Module } from '@nestjs/common';

import { MedplumModule } from '../medplum/medplum.module';

import { LaboratoryController } from './laboratory.controller';
import { LaboratoryService } from './laboratory.service';

import { LaboratoryResultsController } from './laboratory-results.controller';
import { LaboratoryResultsService } from './laboratory-results.service';

import { LaboratoryReportsController } from './laboratory-reports.controller';
import { LaboratoryReportsService } from './laboratory-reports.service';

@Module({
  imports: [MedplumModule],

  controllers: [
    LaboratoryController,
    LaboratoryResultsController,
    LaboratoryReportsController,
  ],

  providers: [
    LaboratoryService,
    LaboratoryResultsService,
    LaboratoryReportsService,
  ],

  exports: [
    LaboratoryService,
    LaboratoryResultsService,
    LaboratoryReportsService,
  ],
})
export class LaboratoryModule {}
