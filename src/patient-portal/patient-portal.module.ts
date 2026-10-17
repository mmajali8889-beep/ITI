import { Module } from '@nestjs/common';
import { MedplumModule } from '../medplum/medplum.module';
import { PatientPortalController } from './patient-portal.controller';
import { PatientPortalService } from './patient-portal.service';
@Module({ imports: [MedplumModule], controllers: [PatientPortalController], providers: [PatientPortalService] })
export class PatientPortalModule {}
