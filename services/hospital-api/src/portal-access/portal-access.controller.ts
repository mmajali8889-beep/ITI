import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthSession } from '../auth/auth.types';
import { CreatePortalAccessDto } from './dto/portal-access.dto';
import { PortalAccessService } from './portal-access.service';

/**
 * Staff management of a patient's portal login. Under /api/medical-records so
 * the 'medical-records' permission guards it; the audit interceptor records
 * each call (reads included) against the patient in the route. Always scoped
 * to the signed-in hospital.
 */
@Controller('api/medical-records/portal-access')
export class PortalAccessController {
  constructor(private readonly service: PortalAccessService) {}
  @Get(':patientId') status(
    @Param('patientId') patientId: string,
    @Req() request: Request & { auth?: AuthSession },
  ) {
    return this.service.status(patientId, this.hospital(request));
  }
  @Post(':patientId') create(
    @Param('patientId') patientId: string,
    @Body() dto: CreatePortalAccessDto,
    @Req() request: Request & { auth?: AuthSession },
  ) {
    return this.service.create(patientId, this.hospital(request), dto);
  }
  @Post(':patientId/disable') disable(
    @Param('patientId') patientId: string,
    @Req() request: Request & { auth?: AuthSession },
  ) {
    return this.service.disable(patientId, this.hospital(request));
  }
  private hospital(request: Request & { auth?: AuthSession }): string {
    const hospitalId = request.auth?.hospitalId;
    if (!hospitalId) throw new UnauthorizedException('Sign in is required');
    return hospitalId;
  }
}
