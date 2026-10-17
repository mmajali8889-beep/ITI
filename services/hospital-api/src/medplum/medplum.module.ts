import { Global, Module } from '@nestjs/common';
import { MedplumService } from './medplum.service';

@Global()
@Module({
  providers: [MedplumService],
  exports: [MedplumService],
})
export class MedplumModule {}
