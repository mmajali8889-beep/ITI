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
  ArchiveRecordDto,
  AssessRecordDto,
  AmendRecordDto,
  CloseRecordDto,
  LockRecordDto,
  ResolveDeficiencyDto,
} from './dto/medical-record.dto';
import { MedicalRecordsService } from './medical-records.service';
@Controller('api/medical-records')
export class MedicalRecordsController {
  constructor(private readonly service: MedicalRecordsService) {}
  @Post('encounters/:encounterId/assess') assess(
    @Param('encounterId') id: string,
    @Body() dto: AssessRecordDto,
  ) {
    return this.service.assess(id, dto);
  }
  @Post('encounters/:encounterId/close') close(
    @Param('encounterId') id: string,
    @Body() dto: CloseRecordDto,
  ) {
    return this.service.close(id, dto);
  }
  @Get('queue') queue(@Query('hospitalId') hospitalId: string) {
    return this.service.queue(hospitalId);
  }
  @Get('encounters/:encounterId') get(
    @Param('encounterId') id: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.service.get(id, hospitalId);
  }
  @Patch('deficiencies/:taskId/resolve') resolve(
    @Param('taskId') id: string,
    @Body() dto: ResolveDeficiencyDto,
  ) {
    return this.service.resolveDeficiency(id, dto);
  }
  @Post(':recordId/amendments') amend(
    @Param('recordId') id: string,
    @Body() dto: AmendRecordDto,
  ) {
    return this.service.amend(id, dto);
  }
  @Post(':recordId/lock') lock(
    @Param('recordId') id: string,
    @Body() dto: LockRecordDto,
  ) {
    return this.service.lock(id, dto);
  }
  @Post(':recordId/archive') archive(
    @Param('recordId') id: string,
    @Body() dto: ArchiveRecordDto,
  ) {
    return this.service.archive(id, dto);
  }
}
