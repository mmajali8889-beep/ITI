import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { JourneyPathwaysService } from './journey-pathways.service';

/** Under /api/administration, so the 'administration' permission guards it. */
@Controller('api/administration/journey-pathways')
export class JourneyPathwaysController {
  constructor(private readonly service: JourneyPathwaysService) {}
  @Get() list(@Query('hospitalId') hospitalId: string) {
    return this.service.list(hospitalId);
  }
  @Put() save(
    @Body() body: { hospitalId: string; pathways: Record<string, unknown> },
  ) {
    return this.service.save(body?.hospitalId, body?.pathways);
  }
}
