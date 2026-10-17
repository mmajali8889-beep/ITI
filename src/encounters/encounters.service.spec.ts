import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MedplumService } from '../medplum/medplum.service';
import { EncountersService } from './encounters.service';
import type { CreateEncounterDto } from './dto/create-encounter.dto';

describe('EncountersService reception workflow', () => {
  let service: EncountersService;
  const medplum = {
    readResource: jest.fn(),
    searchResources: jest.fn(),
    createResource: jest.fn(),
    updateResource: jest.fn(),
  };
  const valid = (): CreateEncounterDto => ({
    patientId: 'patient-1',
    hospitalId: 'hospital-a',
    encounterType: 'outpatient',
    department: 'Cardiology',
    reason: 'Chest discomfort',
    priority: 'urgent',
    arrivalMode: 'walk-in',
    registrationConfirmed: true,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    medplum.readResource.mockResolvedValue({
      resourceType: 'Patient',
      id: 'patient-1',
      managingOrganization: { reference: 'Organization/hospital-a' },
    });
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (resource) => ({
      ...resource,
      id: 'encounter-1',
    }));
    medplum.updateResource.mockImplementation(async (resource) => resource);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncountersService,
        { provide: MedplumService, useValue: { getClient: () => medplum, updateIfUnchanged: async (r: unknown) => r } },
      ],
    }).compile();
    service = module.get(EncountersService);
  });

  it('creates a scoped active visit with operational metadata', async () => {
    const result = await service.create(valid());
    expect(result).toMatchObject({
      id: 'encounter-1',
      hospitalId: 'hospital-a',
      patientId: 'patient-1',
      priority: 'urgent',
      arrivalMode: 'walk-in',
    });
    expect(result.visitNumber).toMatch(/^VIS-\d{4}-[A-F0-9]{8}$/);
  });

  it('financially clears a cash encounter at registration', async () => {
    const result = await service.create({ ...valid(), financialClass: 'cash' });
    expect(result).toMatchObject({
      financialClass: 'cash',
      financialClearanceStatus: 'cleared',
    });
  });

  it.each([
    ['day-case', 'SS'],
    ['diagnostic', 'AMB'],
    ['laboratory-only', 'AMB'],
    ['radiology-only', 'AMB'],
    ['procedure', 'AMB'],
  ] as const)(
    'creates the mandatory %s encounter type',
    async (encounterType, classCode) => {
      const result = await service.create({ ...valid(), encounterType });
      expect(result).toMatchObject({ encounterType });
      expect(result.financialClearanceStatus).toBe('pending-classification');
      expect(medplum.createResource).toHaveBeenCalledWith(
        expect.objectContaining({
          class: expect.objectContaining({ code: classCode }),
        }),
      );
    },
  );

  it('blocks a second active encounter in the same hospital', async () => {
    medplum.searchResources.mockResolvedValue([
      {
        resourceType: 'Encounter',
        id: 'active-1',
        status: 'in-progress',
        serviceProvider: { reference: 'Organization/hospital-a' },
      },
    ]);
    await expect(service.create(valid())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(medplum.createResource).not.toHaveBeenCalled();
  });

  it('rejects a patient belonging to another hospital', async () => {
    medplum.readResource.mockResolvedValue({
      resourceType: 'Patient',
      id: 'patient-1',
      managingOrganization: { reference: 'Organization/hospital-b' },
    });
    await expect(service.create(valid())).rejects.toThrow(
      'Patient does not belong to the selected hospital',
    );
  });

  it('requires a reference for referral arrival mode', async () => {
    const dto = valid();
    dto.arrivalMode = 'referral';
    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
  });

  it('hides an encounter outside the requested hospital boundary', async () => {
    medplum.readResource.mockResolvedValue({
      resourceType: 'Encounter',
      id: 'encounter-1',
      status: 'in-progress',
      serviceProvider: { reference: 'Organization/hospital-b' },
    });
    await expect(service.findById('encounter-1', 'hospital-a')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns only emergency encounters inside the hospital boundary', async () => {
    medplum.searchResources.mockResolvedValue([
      {
        resourceType: 'Encounter',
        id: 'ed-1',
        status: 'triaged',
        class: { code: 'EMER' },
        serviceProvider: { reference: 'Organization/hospital-a' },
        subject: {
          reference: 'Patient/patient-1',
          display: 'Emergency Patient',
        },
      },
      {
        resourceType: 'Encounter',
        id: 'clinic-1',
        status: 'in-progress',
        class: { code: 'AMB' },
        serviceProvider: { reference: 'Organization/hospital-a' },
      },
      {
        resourceType: 'Encounter',
        id: 'ed-2',
        status: 'triaged',
        class: { code: 'EMER' },
        serviceProvider: { reference: 'Organization/hospital-b' },
      },
    ]);
    await expect(
      service.listEmergency('hospital-a', 'triaged'),
    ).resolves.toMatchObject({
      total: 1,
      encounters: [{ id: 'ed-1', patientName: 'Emergency Patient' }],
    });
  });

  it('assigns an ED bed and records a reassessment for an emergency encounter', async () => {
    const emergency = {
      resourceType: 'Encounter',
      id: 'ed-1',
      status: 'triaged',
      class: { code: 'EMER' },
      subject: { reference: 'Patient/patient-1' },
      serviceProvider: { reference: 'Organization/hospital-a' },
      extension: [],
    };
    medplum.readResource.mockResolvedValue(emergency);
    const bed = await service.assignEmergencyBed('ed-1', {
      hospitalId: 'hospital-a',
      bedId: 'bed-1',
      bedName: 'ED-01',
    });
    expect(bed).toMatchObject({ bedId: 'bed-1', bedName: 'ED-01' });
    const reassessment = await service.reassessEmergency('ed-1', {
      hospitalId: 'hospital-a',
      severity: 2,
      clinicalStatus: 'deteriorated',
      note: 'Increasing respiratory distress',
      clinicianName: 'ED Doctor',
    });
    expect(reassessment).toMatchObject({
      severity: 2,
      clinicalStatus: 'deteriorated',
    });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'Observation',
        code: expect.objectContaining({ text: 'Emergency reassessment' }),
      }),
    );
  });

  it('allows an emergency LWBS disposition without diagnosis or signed note', async () => {
    medplum.readResource.mockResolvedValue({
      resourceType: 'Encounter',
      id: 'ed-1',
      status: 'in-progress',
      class: { code: 'EMER' },
      serviceProvider: { reference: 'Organization/hospital-a' },
      period: {},
    });
    medplum.searchResources.mockResolvedValue([]);
    await expect(
      service.finish('ed-1', {
        hospitalId: 'hospital-a',
        disposition: 'left-without-being-seen',
        dischargeCondition: 'unchanged',
        confirmation: true,
      }),
    ).resolves.toMatchObject({
      status: 'finished',
      disposition: 'left-without-being-seen',
    });
  });

  it('blocks disposition until a primary diagnosis exists', async () => {
    medplum.readResource.mockResolvedValue({
      resourceType: 'Encounter',
      id: 'encounter-1',
      status: 'triaged',
      serviceProvider: { reference: 'Organization/hospital-a' },
    });
    medplum.searchResources.mockResolvedValue([]);
    await expect(
      service.finish('encounter-1', {
        hospitalId: 'hospital-a',
        disposition: 'home',
        dischargeCondition: 'stable',
        dischargeInstructions: 'Return if symptoms become worse.',
        confirmation: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('completes a disposition when clinical gates are satisfied', async () => {
    medplum.readResource.mockResolvedValue({
      resourceType: 'Encounter',
      id: 'encounter-1',
      status: 'triaged',
      serviceProvider: { reference: 'Organization/hospital-a' },
      period: {},
    });
    const diagnosis = {
      resourceType: 'Condition',
      extension: [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/diagnosis-rank',
          valueCode: 'primary',
        },
      ],
    };
    const note = {
      resourceType: 'DocumentReference',
      content: [
        {
          attachment: {
            data: Buffer.from(JSON.stringify({ status: 'signed' })).toString(
              'base64',
            ),
          },
        },
      ],
    };
    medplum.searchResources.mockImplementation(async (type: string) => {
      if (type === 'Condition') return [diagnosis];
      if (type === 'DocumentReference') return [note];
      return [];
    });
    const result = await service.finish('encounter-1', {
      hospitalId: 'hospital-a',
      disposition: 'home',
      dischargeCondition: 'improved',
      dischargeInstructions:
        'Continue medicines and return if symptoms worsen.',
      confirmation: true,
    });
    expect(result).toMatchObject({
      status: 'finished',
      disposition: 'home',
      dischargeCondition: 'improved',
    });
  });

  it('blocks community discharge while a clinical order remains active', async () => {
    medplum.readResource.mockResolvedValue({
      resourceType: 'Encounter',
      id: 'encounter-1',
      status: 'triaged',
      serviceProvider: { reference: 'Organization/hospital-a' },
      period: {},
    });
    const diagnosis = {
      resourceType: 'Condition',
      extension: [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/diagnosis-rank',
          valueCode: 'primary',
        },
      ],
    };
    const note = {
      resourceType: 'DocumentReference',
      content: [
        {
          attachment: {
            data: Buffer.from(JSON.stringify({ status: 'signed' })).toString(
              'base64',
            ),
          },
        },
      ],
    };
    medplum.searchResources.mockImplementation(async (type: string) => {
      if (type === 'Condition') return [diagnosis];
      if (type === 'DocumentReference') return [note];
      if (type === 'ServiceRequest')
        return [
          { resourceType: 'ServiceRequest', id: 'lab-1', status: 'active' },
        ];
      return [];
    });

    await expect(
      service.finish('encounter-1', {
        hospitalId: 'hospital-a',
        disposition: 'home',
        dischargeCondition: 'stable',
        dischargeInstructions:
          'Continue medicines and return if symptoms worsen.',
        confirmation: true,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PENDING_CLINICAL_ORDERS' }),
    });
  });

  it('blocks community discharge until every final diagnostic report is reviewed', async () => {
    medplum.readResource.mockResolvedValue({
      resourceType: 'Encounter',
      id: 'encounter-1',
      status: 'triaged',
      serviceProvider: { reference: 'Organization/hospital-a' },
      period: {},
    });
    const diagnosis = {
      resourceType: 'Condition',
      extension: [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/diagnosis-rank',
          valueCode: 'primary',
        },
      ],
    };
    const note = {
      resourceType: 'DocumentReference',
      content: [
        {
          attachment: {
            data: Buffer.from(JSON.stringify({ status: 'signed' })).toString(
              'base64',
            ),
          },
        },
      ],
    };
    medplum.searchResources.mockImplementation(async (type: string) => {
      if (type === 'Condition') return [diagnosis];
      if (type === 'DocumentReference') return [note];
      if (type === 'ServiceRequest')
        return [
          { resourceType: 'ServiceRequest', id: 'lab-1', status: 'completed' },
        ];
      if (type === 'DiagnosticReport')
        return [
          { resourceType: 'DiagnosticReport', id: 'report-1', status: 'final' },
        ];
      return [];
    });

    await expect(
      service.finish('encounter-1', {
        hospitalId: 'hospital-a',
        disposition: 'home',
        dischargeCondition: 'stable',
        dischargeInstructions:
          'Continue medicines and return if symptoms worsen.',
        confirmation: true,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNREVIEWED_RESULTS' }),
    });
  });

  it('allows community discharge after final results are reviewed', async () => {
    medplum.readResource.mockResolvedValue({
      resourceType: 'Encounter',
      id: 'encounter-1',
      status: 'triaged',
      serviceProvider: { reference: 'Organization/hospital-a' },
      period: {},
    });
    const diagnosis = {
      resourceType: 'Condition',
      extension: [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/diagnosis-rank',
          valueCode: 'primary',
        },
      ],
    };
    const note = {
      resourceType: 'DocumentReference',
      content: [
        {
          attachment: {
            data: Buffer.from(JSON.stringify({ status: 'signed' })).toString(
              'base64',
            ),
          },
        },
      ],
    };
    medplum.searchResources.mockImplementation(async (type: string) => {
      if (type === 'Condition') return [diagnosis];
      if (type === 'DocumentReference') return [note];
      if (type === 'ServiceRequest')
        return [
          { resourceType: 'ServiceRequest', id: 'lab-1', status: 'completed' },
        ];
      if (type === 'DiagnosticReport')
        return [
          { resourceType: 'DiagnosticReport', id: 'report-1', status: 'final' },
        ];
      if (type === 'Task')
        return [
          {
            resourceType: 'Task',
            status: 'completed',
            code: { coding: [{ code: 'result-review' }] },
            focus: { reference: 'DiagnosticReport/report-1' },
          },
        ];
      return [];
    });

    await expect(
      service.finish('encounter-1', {
        hospitalId: 'hospital-a',
        disposition: 'home',
        dischargeCondition: 'improved',
        dischargeInstructions:
          'Continue medicines and return if symptoms worsen.',
        confirmation: true,
      }),
    ).resolves.toMatchObject({ status: 'finished', disposition: 'home' });
  });
});
