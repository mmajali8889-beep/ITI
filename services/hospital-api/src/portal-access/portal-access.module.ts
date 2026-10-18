import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortalAccessController } from './portal-access.controller';
import { PortalAccessService } from './portal-access.service';
@Module({
  imports: [AuthModule],
  controllers: [PortalAccessController],
  providers: [PortalAccessService],
})
export class PortalAccessModule {}
