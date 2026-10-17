import { Module } from '@nestjs/common';
import { MedplumModule } from '../medplum/medplum.module';
import { SurgeryController } from './surgery.controller';
import { SurgeryService } from './surgery.service';
@Module({
  imports: [MedplumModule],
  controllers: [SurgeryController],
  providers: [SurgeryService],
})
export class SurgeryModule {}
