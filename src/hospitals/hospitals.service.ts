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
        // Filter server-side: departments are Organizations too, and the
        // default page size (20) would otherwise drop hospitals.
        type: 'https://hospital-ehr.local/organization-type|hospital',
        _count: '200',
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