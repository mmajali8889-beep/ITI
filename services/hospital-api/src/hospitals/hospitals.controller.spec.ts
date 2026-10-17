import { Test, TestingModule } from '@nestjs/testing';
import { HospitalsController } from './hospitals.controller';
import { HospitalsService } from './hospitals.service';

describe('HospitalsController', () => {
  it('is created with its dependency', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HospitalsController],
      providers: [{ provide: HospitalsService, useValue: {} }],
    }).compile();
    expect(module.get(HospitalsController)).toBeDefined();
  });
});
