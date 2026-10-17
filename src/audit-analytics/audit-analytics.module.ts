import { Module } from '@nestjs/common';
import { AuditAnalyticsController } from './audit-analytics.controller';
import { AuditAnalyticsService } from './audit-analytics.service';
import { AuditInterceptor } from './audit.interceptor';
@Module({ controllers: [AuditAnalyticsController], providers: [AuditAnalyticsService, AuditInterceptor], exports: [AuditAnalyticsService, AuditInterceptor] })
export class AuditAnalyticsModule {}
