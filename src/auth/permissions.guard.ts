import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthSession } from './auth.types';

const ROUTE_PERMISSIONS: Record<string, string> = {
  patients: 'patients', encounters: 'clinical', vitals: 'clinical', conditions: 'clinical', allergies: 'clinical',
  'clinical-notes': 'clinical', 'clinical-services': 'clinical', 'result-reviews': 'clinical', 'patient-journey': 'clinical',
  appointments: 'appointments', laboratory: 'laboratory', radiology: 'radiology', pharmacy: 'pharmacy', medications: 'pharmacy',
  inpatient: 'inpatient', nursing: 'nursing', 'inpatient-rounds': 'rounds', surgery: 'surgery', icu: 'icu', consultations: 'consultations',
  'bed-management': 'bed-management', discharge: 'discharge', billing: 'billing', financial: 'billing', 'medical-records': 'medical-records',
  inventory: 'inventory', administration: 'administration', audit: 'administration',
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { auth?: AuthSession }>();
    const segment = request.path.split('/').filter(Boolean)[1];
    const required = ROUTE_PERMISSIONS[segment];
    if (!required) return true;
    const permissions = request.auth?.permissions ?? [];
    if (permissions.includes('*') || permissions.includes(required)) return true;
    throw new ForbiddenException(`Permission '${required}' is required`);
  }
}
