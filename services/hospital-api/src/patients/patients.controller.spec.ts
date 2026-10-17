import { Test, TestingModule } from '@nestjs/testing';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

describe('PatientsController', () => {
  it('is created with its dependency', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PatientsController],
      providers: [{ provide: PatientsService, useValue: {} }],
    }).compile();
    expect(module.get(PatientsController)).toBeDefined();
  });
});
