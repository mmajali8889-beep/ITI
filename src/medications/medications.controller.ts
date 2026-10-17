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
  MedicationsService,
} from './medications.service';

import {
  CreateMedicationRequestDto,
} from './dto/create-medication-request.dto';

@Controller(
  'api/medications',
)
export class MedicationsController {
  constructor(
    private readonly medicationsService:
      MedicationsService,
  ) {}

  @Post()
  create(
    @Body()
    dto:
      CreateMedicationRequestDto,
  ) {
    return this.medicationsService.create(
      dto,
    );
  }

  @Get()
  findByEncounter(
    @Query('encounterId')
    encounterId:
      string,
  ) {
    return this.medicationsService.findByEncounter(
      encounterId,
    );
  }

  @Get(
    'patient/:patientId',
  )
  findByPatient(
    @Param('patientId')
    patientId:
      string,
  ) {
    return this.medicationsService.findByPatient(
      patientId,
    );
  }

  @Get(
    ':medicationRequestId',
  )
  findById(
    @Param(
      'medicationRequestId',
    )
    medicationRequestId:
      string,
  ) {
    return this.medicationsService.findById(
      medicationRequestId,
    );
  }

  @Patch(
    ':medicationRequestId/status',
  )
  updateStatus(
    @Param(
      'medicationRequestId',
    )
    medicationRequestId:
      string,

    @Body()
    body: {
      status:
        string;
    },
  ) {
    return this.medicationsService.updateStatus(
      medicationRequestId,
      body.status,
    );
  }
}