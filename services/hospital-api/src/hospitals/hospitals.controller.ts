import { Controller, Get } from '@nestjs/common';
import { HospitalsService } from './hospitals.service';
import { Public } from '../auth/public.decorator';

@Controller('api/hospitals')
@Public()
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  findAll() {
    return this.hospitalsService.findAll();
  }
}
