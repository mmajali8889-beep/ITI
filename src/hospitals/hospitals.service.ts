import { Injectable } from '@nestjs/common';
import { MedplumService } from '../medplum/medplum.service';

@Injectable()
export class HospitalsService {
  constructor(
    private readonly medplumService: MedplumService,
  ) {}

  async findAll() {
    const medplum = this.medplumService.getClient();

    const organizations =
      await medplum.searchResources('Organization', {
        active: 'true',
      });

    return organizations
      .filter((organization) =>
        organization.type?.some((type) =>
          type.coding?.some(
            (coding) =>
              coding.system ===
                'https://hospital-ehr.local/organization-type' &&
              coding.code === 'hospital',
          ),
        ),
      )
      .map((hospital) => ({
        id: hospital.id,

        name: hospital.name,

        code: hospital.identifier?.find(
          (identifier) =>
            identifier.system ===
            'https://hospital-ehr.local/organization-code',
        )?.value,
      }));
  }
}