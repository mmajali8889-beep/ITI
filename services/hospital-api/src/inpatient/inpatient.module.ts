import { Module } from '@nestjs/common';
import { InpatientController } from './inpatient.controller';
import { InpatientService } from './inpatient.service';
import { BedManagementModule } from '../bed-management/bed-management.module';

@Module({
  imports: [BedManagementModule],
  controllers: [InpatientController],
  providers: [InpatientService],
})
export class InpatientModule {}
