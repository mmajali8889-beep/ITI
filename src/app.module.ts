
import {
  ClinicalNotesModule,
} from './clinical-notes/clinical-notes.module';

import {
  Module,
} from '@nestjs/common';

import {
  ConfigModule,
} from '@nestjs/config';

import {
  AppController,
} from './app.controller';

import {
  AppService,
} from './app.service';

import {
  MedplumModule,
} from './medplum/medplum.module';

import {
  HospitalsModule,
} from './hospitals/hospitals.module';

import {
  PatientsModule,
} from './patients/patients.module';

import {
  EncountersModule,
} from './encounters/encounters.module';

import {
  VitalsModule,
} from './vitals/vitals.module';

import {
  ConditionsModule,
} from './conditions/conditions.module';

import {
  AllergiesModule,
} from './allergies/allergies.module';

import {
  MedicationsModule,
} from './medications/medications.module';

import { 
  LaboratoryModule } 
  from './laboratory/laboratory.module';
import { 
  RadiologyModule } 
  from './radiology/radiology.module';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MedplumRateLimitFilter } from './medplum/medplum-rate-limit.filter';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { InpatientModule } from './inpatient/inpatient.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { FinancialModule } from './financial/financial.module';
import { ClinicalServicesModule } from './clinical-services/clinical-services.module';
import { ResultReviewsModule } from './result-reviews/result-reviews.module';
import { BillingModule } from './billing/billing.module';
import { MedicalRecordsModule } from './medical-records/medical-records.module';
import { AuditAnalyticsModule } from './audit-analytics/audit-analytics.module';
import { AuditInterceptor } from './audit-analytics/audit.interceptor';
import { NursingModule } from './nursing/nursing.module';
import { InpatientRoundsModule } from './inpatient-rounds/inpatient-rounds.module';
import { SurgeryModule } from './surgery/surgery.module';
import { IcuModule } from './icu/icu.module';
import { ConsultationsModule } from './consultations/consultations.module';
import { BedManagementModule } from './bed-management/bed-management.module';
import { DischargeModule } from './discharge/discharge.module';
import { PatientPortalModule } from './patient-portal/patient-portal.module';
import { AdministrationModule } from './administration/administration.module';
import { RolesGuard } from './auth/roles.guard';
import { InventoryModule } from './inventory/inventory.module';
import { PatientJourneyModule } from './patient-journey/patient-journey.module';
import { PermissionsGuard } from './auth/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal:
        true,

      envFilePath:
        '.env',
    }),
	
	RadiologyModule,
    
	LaboratoryModule,

    MedplumModule,

    HospitalsModule,

    PatientsModule,

    EncountersModule,

    VitalsModule,

    ConditionsModule,

    AllergiesModule,

    MedicationsModule,
	
    ClinicalNotesModule,
    AuthModule,
    InpatientModule,
    AppointmentsModule,
    PharmacyModule,
    FinancialModule,
    ClinicalServicesModule,
    ResultReviewsModule,
    BillingModule,
    MedicalRecordsModule,
    AuditAnalyticsModule,
    NursingModule,
    InpatientRoundsModule,
    SurgeryModule,
    IcuModule,
    ConsultationsModule,
    BedManagementModule,
    DischargeModule,
    PatientPortalModule,
    AdministrationModule,
    InventoryModule,
    PatientJourneyModule,
  ],

  controllers: [
    AppController,
  ],

  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_FILTER,
      useClass: MedplumRateLimitFilter,
    },
  ],
})
export class AppModule {}
