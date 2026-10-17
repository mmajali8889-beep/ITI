import { Module } from '@nestjs/common';
import { MedplumModule } from '../medplum/medplum.module';
import { NursingController } from './nursing.controller';
import { NursingService } from './nursing.service';
@Module({
  imports: [MedplumModule],
  controllers: [NursingController],
  providers: [NursingService],
  exports: [NursingService],
})
export class NursingModule {}
