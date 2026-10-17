import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Encounter, Patient } from '@medplum/fhirtypes';
import type { Request } from 'express';
import { MedplumService } from '../medplum/medplum.service';
import type { AuthSession } from './auth.types';

/**
 * Keeps every patient- or encounter-addressed request inside the hospital of the
 * authenticated session. AuthGuard only compares an explicit `hospitalId`; many
 * read endpoints are addressed by `patientId` / `encounterId` alone, so without
 * this check they return another hospital's records.
 *
 * Runs after AuthGuard. A record outside the session hospital is reported as not
 * found, so the response does not reveal that it exists.
 */
@Injectable()
export class HospitalScopeGuard implements CanActivate {
  constructor(private readonly medplumService: MedplumService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { auth?: AuthSession }>();
    const session = request.auth;
    if (!session) return true; // public route; AuthGuard has already decided

    const patientId = this.pick(request.params?.patientId, request.query?.patientId);
    const encounterId = this.pick(request.params?.encounterId, request.query?.encounterId);
    if (!patientId && !encounterId) return true;

    const organization = `Organization/${session.hospitalId}`;
    const client = this.medplumService.getClient();

    if (patientId) {
      const patient = await client.readResource('Patient', patientId).catch(() => undefined) as Patient | undefined;
      if (!patient || patient.managingOrganization?.reference !== organization) {
        throw new NotFoundException('Patient not found');
      }
    }
    if (encounterId) {
      const encounter = await client.readResource('Encounter', encounterId).catch(() => undefined) as Encounter | undefined;
      if (!encounter || encounter.serviceProvider?.reference !== organization) {
        throw new NotFoundException('Encounter not found');
      }
      if (patientId && encounter.subject?.reference !== `Patient/${patientId}`) {
        throw new NotFoundException('Encounter not found');
      }
    }
    return true;
  }

  private pick(...values: unknown[]): string | undefined {
    const value = values.find((item) => typeof item === 'string' && item.trim());
    return typeof value === 'string' ? value.trim() : undefined;
  }
}
