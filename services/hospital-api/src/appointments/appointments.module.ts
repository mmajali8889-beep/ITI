import { Module } from '@nestjs/common';
import { EncountersModule } from '../encounters/encounters.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { SchedulingService } from './scheduling.service';

@Module({
  imports: [EncountersModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, SchedulingService],
})
export class AppointmentsModule {}
