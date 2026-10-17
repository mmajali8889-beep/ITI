import { Module } from '@nestjs/common';
import { MedplumModule } from '../medplum/medplum.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
@Module({
  imports: [MedplumModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
