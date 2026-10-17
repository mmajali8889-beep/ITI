import { Module } from '@nestjs/common';
import { MedplumModule } from '../medplum/medplum.module';
import { IcuController } from './icu.controller';
import { IcuService } from './icu.service';
@Module({
  imports: [MedplumModule],
  controllers: [IcuController],
  providers: [IcuService],
})
export class IcuModule {}
