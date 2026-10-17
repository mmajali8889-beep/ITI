import { Module } from '@nestjs/common';

import { ClinicalNotesController } from './clinical-notes.controller';

import { ClinicalNotesService } from './clinical-notes.service';

@Module({
  controllers: [ClinicalNotesController],

  providers: [ClinicalNotesService],

  exports: [ClinicalNotesService],
})
export class ClinicalNotesModule {}
