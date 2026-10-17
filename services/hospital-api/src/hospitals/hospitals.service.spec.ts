import { Test, TestingModule } from '@nestjs/testing';
import { MedplumService } from '../medplum/medplum.service';
import { HospitalsService } from './hospitals.service';

describe('HospitalsService', () => {
  it('is created with its Medplum dependency', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HospitalsService,
        { provide: MedplumService, useValue: { getClient: jest.fn() } },
      ],
    }).compile();
    expect(module.get(HospitalsService)).toBeDefined();
  });
});
