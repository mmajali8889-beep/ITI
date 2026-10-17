import { Module } from '@nestjs/common';
import { ResultReviewsController } from './result-reviews.controller';
import { ResultReviewsService } from './result-reviews.service';

@Module({
  controllers: [ResultReviewsController],
  providers: [ResultReviewsService],
  exports: [ResultReviewsService],
})
export class ResultReviewsModule {}
