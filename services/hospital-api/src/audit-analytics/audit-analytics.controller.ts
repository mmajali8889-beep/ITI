import { Controller, Get, Query } from '@nestjs/common';
import { AuditAnalyticsService } from './audit-analytics.service';
import { Roles } from '../auth/roles.decorator';
@Controller('api')
export class AuditAnalyticsController {
  constructor(private readonly service: AuditAnalyticsService) {}
  @Roles('administrator', 'system-administrator', 'medical-records') @Get('audit/events') events(@Query('hospitalId') hospitalId: string, @Query('limit') limit?: string, @Query('patientId') patientId?: string, @Query('encounterId') encounterId?: string) { return this.service.events(hospitalId, Number(limit), { patientId, encounterId }); }
  @Get('analytics/overview') overview(@Query('hospitalId') hospitalId: string) { return this.service.overview(hospitalId); }
}
