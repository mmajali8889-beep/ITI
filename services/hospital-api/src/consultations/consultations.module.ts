import { Module } from '@nestjs/common';
import { MedplumModule } from '../medplum/medplum.module';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
@Module({
  imports: [MedplumModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService],
})
export class ConsultationsModule {}
