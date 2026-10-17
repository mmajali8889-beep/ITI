export class CreateBedDto {
  hospitalId!: string;
  floorCode?: string;
  floorName?: string;
  wardCode!: string;
  wardName!: string;
  roomNumber!: string;
  bedCode!: string;
}

export class AssignBedDto {
  hospitalId!: string;
  encounterId!: string;
  patientId!: string;
  bedId!: string;
  admissionReason!: string;
  admissionRequestId!: string;
}

export class CreateAdmissionRequestDto {
  hospitalId!: string;
  patientId!: string;
  encounterId!: string;
  requestedWard?: string;
  acuity!: 'routine' | 'urgent' | 'emergency';
  admissionReason!: string;
  requestingPhysicianId?: string;
  requestingPhysicianName!: string;
}
export class ReviewAdmissionRequestDto {
  hospitalId!: string;
  decision!: 'approved' | 'rejected';
  admissionOfficerId?: string;
  admissionOfficerName!: string;
  note?: string;
}
export class RecordAdmissionAuthorizationDto {
  hospitalId!: string;
  status!: 'approved' | 'denied' | 'not-required';
  authorizationNumber?: string;
  authorizedBy!: string;
  note?: string;
}
export class CreateBedRequestDto {
  hospitalId!: string;
  preferredWard?: string;
  isolationRequired?: boolean;
  bedType?: string;
  note?: string;
}

export class TransferBedDto {
  hospitalId!: string;
  encounterId!: string;
  targetBedId!: string;
  reason!: string;
}
