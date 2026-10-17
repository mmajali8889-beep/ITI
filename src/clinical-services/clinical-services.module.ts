import { Module } from '@nestjs/common';
import { ClinicalServicesController } from './clinical-services.controller';
import { ClinicalServicesService } from './clinical-services.service';

@Module({ controllers: [ClinicalServicesController], providers: [ClinicalServicesService], exports: [ClinicalServicesService] })
export class ClinicalServicesModule {}
