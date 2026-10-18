import { Module } from '@nestjs/common';
import { MedplumModule } from '../medplum/medplum.module';
import { PatientJourneyController } from './patient-journey.controller';
import { PatientJourneyService } from './patient-journey.service';
import { JourneyPathwaysController } from './journey-pathways.controller';
import { JourneyPathwaysService } from './journey-pathways.service';
@Module({
  imports: [MedplumModule],
  controllers: [PatientJourneyController, JourneyPathwaysController],
  providers: [PatientJourneyService, JourneyPathwaysService],
})
export class PatientJourneyModule {}
