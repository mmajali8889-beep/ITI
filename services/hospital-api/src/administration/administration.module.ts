import { Module } from '@nestjs/common';
import { MedplumModule } from '../medplum/medplum.module';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';
@Module({
  imports: [MedplumModule],
  controllers: [AdministrationController],
  providers: [AdministrationService],
})
export class AdministrationModule {}
