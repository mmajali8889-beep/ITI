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
  ClinicalNotesService,
} from './clinical-notes.service';

import {
  CreateAddendumDto,
  CreateClinicalNoteDto,
  UpdateClinicalNoteDto,
  SignClinicalNoteDto,
} from './dto/clinical-note.dto';

@Controller(
  'api/clinical-notes',
)
export class ClinicalNotesController {
  constructor(
    private readonly clinicalNotesService:
      ClinicalNotesService,
  ) {}

  @Post()
  create(
    @Body()
    dto: CreateClinicalNoteDto,
  ) {
    return this.clinicalNotesService.create(
      dto,
    );
  }

  @Get()
  findByEncounter(
    @Query('encounterId')
    encounterId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.clinicalNotesService.findByEncounter(
      encounterId,
      hospitalId,
    );
  }

  @Get('patient/:patientId')
  findByPatient(
    @Param('patientId')
    patientId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.clinicalNotesService.findByPatient(
      patientId,
      hospitalId,
    );
  }

  @Get(':noteId')
  findById(
    @Param('noteId')
    noteId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.clinicalNotesService.findById(
      noteId,
      hospitalId,
    );
  }

  @Patch(':noteId')
  update(
    @Param('noteId')
    noteId: string,

    @Body()
    dto: UpdateClinicalNoteDto,
  ) {
    return this.clinicalNotesService.update(
      noteId,
      dto,
    );
  }

  @Post(':noteId/sign')
  sign(
    @Param('noteId')
    noteId: string,
    @Body() dto: SignClinicalNoteDto,
  ) {
    return this.clinicalNotesService.sign(
      noteId,
      dto,
    );
  }

  @Post(':noteId/addendum')
  createAddendum(
    @Param('noteId')
    noteId: string,

    @Body()
    dto: CreateAddendumDto,
  ) {
    return this.clinicalNotesService.createAddendum(
      noteId,
      dto,
    );
  }
}
