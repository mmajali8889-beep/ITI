export class CreateLabOrderDto {
  patientId!: string;
  encounterId!: string;
  hospitalId!: string;

  testCode!: string;
  testName!: string;

  priority?: 'routine' | 'urgent' | 'asap' | 'stat';

  practitionerId?: string;
  practitionerName?: string;

  clinicalNote?: string;
}