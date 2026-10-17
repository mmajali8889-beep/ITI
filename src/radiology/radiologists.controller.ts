import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import {
  CreateRadiologistDto,
} from './dto/create-radiologist.dto';

import {
  UpdateRadiologistDto,
} from './dto/update-radiologist.dto';

import {
  RadiologistsService,
} from './radiologists.service';

@Controller('api/radiology/radiologists')
export class RadiologistsController {
  constructor(
    private readonly radiologistsService:
      RadiologistsService,
  ) {}

  @Get()
  list(
    @Query('hospitalId')
    hospitalId: string,

    @Query('active')
    active?: string,
  ) {
    return this.radiologistsService.list(
      hospitalId,
      active,
    );
  }

  @Post()
  create(
    @Body()
    dto: CreateRadiologistDto,
  ) {
    return this.radiologistsService.create(
      dto,
    );
  }

  @Get(':practitionerId')
  get(
    @Param('practitionerId')
    practitionerId: string,

    @Query('hospitalId')
    hospitalId: string,
  ) {
    return this.radiologistsService.get(
      practitionerId,
      hospitalId,
    );
  }

  @Patch(':practitionerId')
  update(
    @Param('practitionerId')
    practitionerId: string,

    @Body()
    dto: UpdateRadiologistDto,
  ) {
    return this.radiologistsService.update(
      practitionerId,
      dto,
    );
  }
}
