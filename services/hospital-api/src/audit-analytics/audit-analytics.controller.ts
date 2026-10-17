import { Controller, Get, Query } from '@nestjs/common';
import { AuditAnalyticsService } from './audit-analytics.service';
import { Roles } from '../auth/roles.decorator';
@Controller('api')
export class AuditAnalyticsController {
  constructor(private readonly service: AuditAnalyticsService) {}
  @Roles('administrator', 'system-administrator', 'medical-records') @Get('audit/events') events(@Query('hospitalId') hospitalId: string, @Query('limit') limit?: string) { return this.service.events(hospitalId, Number(limit)); }
  @Get('analytics/overview') overview(@Query('hospitalId') hospitalId: string) { return this.service.overview(hospitalId); }
}
