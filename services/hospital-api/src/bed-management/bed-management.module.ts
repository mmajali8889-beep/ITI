import { Module } from '@nestjs/common';
import { MedplumModule } from '../medplum/medplum.module';
import { BedManagementController } from './bed-management.controller';
import { BedManagementService } from './bed-management.service';
@Module({
  imports: [MedplumModule],
  controllers: [BedManagementController],
  providers: [BedManagementService],
  exports: [BedManagementService],
})
export class BedManagementModule {}
