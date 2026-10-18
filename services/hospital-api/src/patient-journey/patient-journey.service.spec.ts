import { NotFoundException } from '@nestjs/common';
import { PatientJourneyService } from './patient-journey.service';
import { JourneyPathwaysService } from './journey-pathways.service';
describe('PatientJourneyService', () => {
  const medplum = { readResource: jest.fn(), searchResources: jest.fn() };
  let service: PatientJourneyService;
  const encounter = {
    resourceType: 'Encounter',
    id: 'e1',
    status: 'in-progress',
    class: { code: 'AMB' },
    subject: { reference: 'Patient/p1' },
    serviceProvider: { reference: 'Organization/h1' },
    extension: [
      {
        url: 'https://hospital-ehr.local/fhir/StructureDefinition/encounter-financial-class',
        valueCode: 'cash',
      },
      {
        url: 'https://hospital-ehr.local/fhir/StructureDefinition/triage-completed-at',
        valueDateTime: '2026-01-01',
      },
    ],
  };
  beforeEach(() => {
    jest.resetAllMocks();
    medplum.readResource.mockResolvedValue(encounter);
    medplum.searchResources.mockResolvedValue([]);
    const medplumService = { getClient: () => medplum } as never;
    service = new PatientJourneyService(
      medplumService,
      new JourneyPathwaysService(medplumService),
    );
  });
  it('isolates the journey by patient and hospital', async () => {
    await expect(service.get('other', 'e1', 'h1')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.get('p1', 'e1', 'other')).rejects.toThrow(
      NotFoundException,
    );
  });
  it('marks inpatient-only branches not applicable for an outpatient journey', async () => {
    const r = await service.get('p1', 'e1', 'h1');
    expect(r.nodes.find((n) => n.key === 'bed')?.state).toBe('not-applicable');
    expect(r.nodes.find((n) => n.key === 'ward')?.state).toBe('not-applicable');
    expect(r.branches.entry).toBe('direct');
  });
  it('identifies a laboratory gap as the current stage after assessment', async () => {
    medplum.searchResources.mockImplementation(async (type: string) =>
      type === 'Condition'
        ? [{ resourceType: 'Condition', id: 'c1' }]
        : type === 'DocumentReference'
          ? [
              {
                resourceType: 'DocumentReference',
                id: 'note-1',
                content: [
                  {
                    attachment: {
                      data: Buffer.from(
                        JSON.stringify({ status: 'signed' }),
                      ).toString('base64'),
                    },
                  },
                ],
              },
            ]
          : type === 'ServiceRequest'
            ? [
                {
                  resourceType: 'ServiceRequest',
                  id: 'o1',
                  status: 'active',
                  category: [{ coding: [{ code: 'laboratory' }] }],
                },
              ]
            : [],
    );
    const r = await service.get('p1', 'e1', 'h1');
    expect(r.nodes.find((n) => n.key === 'assessment')?.state).toBe(
      'completed',
    );
    expect(r.nodes.find((n) => n.key === 'lab')?.state).toBe('current');
    expect(r.currentStage).toBe('lab');
  });

  it('reports 100% only when every mandatory outpatient gate is complete', async () => {
    medplum.readResource.mockResolvedValue({
      ...encounter,
      status: 'finished',
      period: { start: '2026-09-28T08:00:00Z', end: '2026-09-28T09:00:00Z' },
    });
    const hospitalExtension = {
      url: 'https://hospital-ehr.local/fhir/StructureDefinition/test-hospital',
      valueReference: { reference: 'Organization/h1' },
    };
    const signedNote = {
      resourceType: 'DocumentReference',
      id: 'note-1',
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
    const resources: Record<string, any[]> = {
      Appointment: [
        {
          resourceType: 'Appointment',
          id: 'follow-1',
          status: 'booked',
          description: 'Follow-up clinic',
          participant: [
            { actor: { reference: 'Patient/p1' }, status: 'accepted' },
          ],
        },
      ],
      Observation: [{ resourceType: 'Observation', id: 'vitals-1' }],
      Condition: [{ resourceType: 'Condition', id: 'condition-1' }],
      DocumentReference: [signedNote],
      ServiceRequest: [
        {
          resourceType: 'ServiceRequest',
          id: 'lab-1',
          category: [{ coding: [{ code: 'laboratory' }] }],
        },
        {
          resourceType: 'ServiceRequest',
          id: 'rad-1',
          category: [{ coding: [{ code: 'imaging' }] }],
        },
      ],
      DiagnosticReport: [
        {
          resourceType: 'DiagnosticReport',
          id: 'lab-report-1',
          status: 'final',
          category: [{ coding: [{ code: 'LAB' }] }],
          basedOn: [{ reference: 'ServiceRequest/lab-1' }],
        },
        {
          resourceType: 'DiagnosticReport',
          id: 'rad-report-1',
          status: 'final',
          category: [{ coding: [{ code: 'RAD' }] }],
          code: { text: 'Radiology report' },
          basedOn: [{ reference: 'ServiceRequest/rad-1' }],
        },
      ],
      MedicationRequest: [
        { resourceType: 'MedicationRequest', id: 'medication-1' },
      ],
      MedicationDispense: [
        {
          resourceType: 'MedicationDispense',
          id: 'dispense-1',
          context: { reference: 'Encounter/e1' },
          authorizingPrescription: [
            { reference: 'MedicationRequest/medication-1' },
          ],
        },
      ],
      Task: [
        {
          resourceType: 'Task',
          id: 'review-1',
          status: 'completed',
          code: { coding: [{ code: 'result-review' }] },
          focus: { reference: 'DiagnosticReport/lab-report-1' },
        },
        {
          resourceType: 'Task',
          id: 'review-2',
          status: 'completed',
          code: { coding: [{ code: 'result-review' }] },
          focus: { reference: 'DiagnosticReport/rad-report-1' },
        },
      ],
      Composition: [
        {
          resourceType: 'Composition',
          id: 'record-1',
          status: 'final',
          type: { coding: [{ code: '34133-9' }] },
          extension: [
            hospitalExtension,
            {
              url: 'https://hospital-ehr.local/fhir/StructureDefinition/record-status',
              valueCode: 'archived',
            },
          ],
        },
      ],
      Invoice: [
        {
          resourceType: 'Invoice',
          id: 'invoice-1',
          status: 'balanced',
          issuer: { reference: 'Organization/h1' },
          extension: [
            hospitalExtension,
            { url: 'encounter', valueString: 'e1' },
          ],
        },
      ],
    };
    medplum.searchResources.mockImplementation(
      async (type: string) => resources[type] ?? [],
    );

    const result = await service.get('p1', 'e1', 'h1');
    expect(result.completion).toBe(100);
    expect(result.currentStage).toBe('complete');
    expect(
      result.nodes.filter(
        (node) => node.state === 'current' || node.state === 'pending',
      ),
    ).toEqual([]);
  });

  it('does not complete laboratory or review when one ordered report is missing', async () => {
    medplum.searchResources.mockImplementation(async (type: string) => {
      if (type === 'Condition')
        return [{ resourceType: 'Condition', id: 'c1' }];
      if (type === 'DocumentReference') {
        return [
          {
            resourceType: 'DocumentReference',
            id: 'note-1',
            content: [
              {
                attachment: {
                  data: Buffer.from(
                    JSON.stringify({ status: 'signed' }),
                  ).toString('base64'),
                },
              },
            ],
          },
        ];
      }
      if (type === 'ServiceRequest') {
        return ['lab-1', 'lab-2'].map((id) => ({
          resourceType: 'ServiceRequest',
          id,
          category: [{ coding: [{ code: 'laboratory' }] }],
        }));
      }
      if (type === 'DiagnosticReport') {
        return [
          {
            resourceType: 'DiagnosticReport',
            id: 'report-1',
            status: 'final',
            category: [{ coding: [{ code: 'LAB' }] }],
            basedOn: [{ reference: 'ServiceRequest/lab-1' }],
          },
        ];
      }
      return [];
    });
    const result = await service.get('p1', 'e1', 'h1');
    expect(result.nodes.find((node) => node.key === 'lab')?.state).toBe(
      'current',
    );
    expect(result.completion).toBeLessThan(100);
  });

  it('recognises radiology orders by their SNOMED imaging category', async () => {
    medplum.searchResources.mockImplementation(async (type: string) =>
      type === 'ServiceRequest'
        ? [
            {
              resourceType: 'ServiceRequest',
              id: 'rad-1',
              category: [
                {
                  coding: [
                    {
                      system: 'http://snomed.info/sct',
                      code: '363679005',
                      display: 'Imaging',
                    },
                  ],
                },
              ],
            },
          ]
        : type === 'DiagnosticReport'
          ? [
              {
                resourceType: 'DiagnosticReport',
                id: 'rad-report-1',
                status: 'final',
                category: [
                  {
                    coding: [
                      {
                        system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
                        code: 'RAD',
                      },
                    ],
                  },
                ],
                basedOn: [{ reference: 'ServiceRequest/rad-1' }],
              },
            ]
          : [],
    );
    const r = await service.get('p1', 'e1', 'h1');
    expect(r.nodes.find((n) => n.key === 'radiology')?.state).toBe('completed');
  });

  describe('care pathways (27.3)', () => {
    const typed = (code: string, cls = 'AMB') => ({
      ...encounter,
      class: { code: cls },
      type: [
        {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/encounter-type',
              code,
            },
          ],
        },
      ],
    });
    const node = (
      r: { nodes: Array<{ key: string; state: string; required?: boolean }> },
      key: string,
    ) => r.nodes.find((n) => n.key === key);

    it('follows the encounter type, and the inpatient pathway once admitted', async () => {
      medplum.readResource.mockResolvedValue(typed('emergency', 'EMER'));
      expect((await service.get('p1', 'e1', 'h1')).pathway).toEqual({
        code: 'emergency',
        label: 'Emergency department',
        source: 'default',
      });
      medplum.readResource.mockResolvedValue(typed('laboratory-only'));
      expect((await service.get('p1', 'e1', 'h1')).pathway.code).toBe(
        'diagnostic',
      );
      medplum.readResource.mockResolvedValue(typed('emergency', 'IMP'));
      expect((await service.get('p1', 'e1', 'h1')).pathway.code).toBe(
        'inpatient',
      );
      medplum.readResource.mockResolvedValue(encounter);
      expect((await service.get('p1', 'e1', 'h1')).pathway.code).toBe(
        'outpatient',
      );
    });

    it('does not let an optional milestone block the journey', async () => {
      // Emergency: payer is optional, triage is mandatory.
      medplum.readResource.mockResolvedValue({
        ...typed('emergency', 'EMER'),
        extension: [],
        status: 'arrived',
      });
      const r = await service.get('p1', 'e1', 'h1');
      expect(node(r, 'payer')).toMatchObject({
        state: 'optional',
        required: false,
      });
      expect(node(r, 'triage')).toMatchObject({
        state: 'current',
        required: true,
      });
      expect(r.currentStage).toBe('triage');
      expect(node(r, 'follow-up')?.state).toBe('optional');
    });

    it('counts only mandatory milestones in completion', async () => {
      // Diagnostic visit: assessment and triage are optional, so a finished
      // visit whose mandatory milestones are done is complete without them.
      medplum.readResource.mockResolvedValue({
        ...typed('diagnostic'),
        status: 'finished',
        extension: [
          {
            url: 'https://hospital-ehr.local/fhir/StructureDefinition/encounter-financial-class',
            valueCode: 'cash',
          },
        ],
      });
      const hospital = {
        url: 'https://hospital-ehr.local/fhir/StructureDefinition/test-hospital',
        valueReference: { reference: 'Organization/h1' },
      };
      medplum.searchResources.mockImplementation(async (type: string) =>
        type === 'Invoice'
          ? [
              {
                resourceType: 'Invoice',
                status: 'balanced',
                extension: [hospital, { url: 'encounter', valueString: 'e1' }],
              },
            ]
          : type === 'Composition'
            ? [
                {
                  resourceType: 'Composition',
                  status: 'final',
                  type: { coding: [{ code: '34133-9' }] },
                  extension: [
                    hospital,
                    {
                      url: 'https://hospital-ehr.local/fhir/StructureDefinition/record-status',
                      valueCode: 'archived',
                    },
                  ],
                },
              ]
            : [],
      );
      const r = await service.get('p1', 'e1', 'h1');
      expect(node(r, 'assessment')?.state).toBe('optional');
      expect(r.completion).toBe(100);
      expect(r.currentStage).toBe('complete');
    });

    it('applies the hospital pathway when one is configured', async () => {
      medplum.searchResources.mockImplementation(async (type: string) =>
        type === 'Basic'
          ? [
              {
                resourceType: 'Basic',
                extension: [
                  {
                    url: 'https://hospital-ehr.local/fhir/StructureDefinition/journey-pathways',
                    valueString: JSON.stringify({
                      outpatient: ['mpi', 'entry', 'encounter', 'follow-up'],
                    }),
                  },
                ],
              },
            ]
          : [],
      );
      const r = await service.get('p1', 'e1', 'h1');
      expect(r.pathway.source).toBe('hospital');
      expect(node(r, 'assessment')?.state).toBe('optional');
      expect(node(r, 'follow-up')?.state).toBe('current');
    });

    it('falls back to the defaults when the configuration cannot be read', async () => {
      medplum.searchResources.mockImplementation(async (type: string) => {
        if (type === 'Basic') throw new Error('Medplum unavailable');
        return [];
      });
      const r = await service.get('p1', 'e1', 'h1');
      expect(r.pathway.source).toBe('default');
    });
  });
});
