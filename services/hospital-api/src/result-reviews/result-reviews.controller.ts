import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RecordResultReviewDto } from './dto/result-review.dto';
import { ResultReviewsService } from './result-reviews.service';

@Controller('api/result-reviews')
export class ResultReviewsController {
  constructor(private readonly service: ResultReviewsService) {}

  @Post()
  record(@Body() dto: RecordResultReviewDto) {
    return this.service.record(dto);
  }

  @Get('encounter/:encounterId')
  byEncounter(
    @Param('encounterId') encounterId: string,
    @Query('hospitalId') hospitalId: string,
  ) {
    return this.service.byEncounter(encounterId, hospitalId);
  }
}
