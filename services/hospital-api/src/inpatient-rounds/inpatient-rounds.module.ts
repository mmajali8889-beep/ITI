import { Module } from '@nestjs/common';
import { MedplumModule } from '../medplum/medplum.module';
import { InpatientRoundsController } from './inpatient-rounds.controller';
import { InpatientRoundsService } from './inpatient-rounds.service';
@Module({
  imports: [MedplumModule],
  controllers: [InpatientRoundsController],
  providers: [InpatientRoundsService],
})
export class InpatientRoundsModule {}
