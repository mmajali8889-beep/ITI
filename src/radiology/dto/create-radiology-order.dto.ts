export class CreateRadiologyOrderDto {
  patientId!: string;
  encounterId!: string;
  hospitalId!: string;

  examCode!: string;
  examName!: string;

  modality!: 'XR' | 'CT' | 'MR' | 'US' | 'MG' | 'NM' | 'PT' | 'DX' | 'OTHER';

  bodySiteCode?: string;
  bodySiteName?: string;

  priority?: 'routine' | 'urgent' | 'asap' | 'stat';

  clinicalIndication?: string;
  clinicalQuestion?: string;

  requesterId?: string;
  requesterName?: string;

  notes?: string;
}
