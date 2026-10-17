import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import {
  CreateRadiologyStationDto,
} from './dto/create-radiology-station.dto';

import {
  UpdateRadiologyStationDto,
} from './dto/update-radiology-station.dto';

import {
  RadiologyStationsService,
} from './radiology-stations.service';

@Controller('api/radiology/stations')
export class RadiologyStationsController {
  constructor(
    private readonly stationsService:
      RadiologyStationsService,
  ) {}

  @Get()
  listStations(
    @Query('hospitalId')
    hospitalId?: string,

    @Query('modality')
    modality?: string,

    @Query('active')
    active?: string,
  ) {
    let activeValue:
      boolean | undefined;

    if (
      active !== undefined &&
      active !== ''
    ) {
      if (
        active !== 'true' &&
        active !== 'false'
      ) {
        throw new BadRequestException(
          'active must be true or false',
        );
      }

      activeValue =
        active === 'true';
    }

    return this.stationsService
      .listStations({
        hospitalId,
        modality,
        active:
          activeValue,
      });
  }


  @Post('sync-orthanc')
  syncHospitalStations(
    @Query('hospitalId')
    hospitalId?: string,
  ) {
    if (
      !hospitalId?.trim()
    ) {
      throw new BadRequestException(
        'hospitalId is required.',
      );
    }

    return this.stationsService
      .syncHospitalStations(
        hospitalId,
      );
  }

  @Get(':stationId/orthanc')
  getOrthancStatus(
    @Param('stationId')
    stationId: string,
  ) {
    return this.stationsService
      .getStationOrthancStatus(
        stationId,
      );
  }

  @Post(':stationId/sync-orthanc')
  syncStationToOrthanc(
    @Param('stationId')
    stationId: string,
  ) {
    return this.stationsService
      .syncStationToOrthanc(
        stationId,
      );
  }

  @Post(':stationId/echo')
  echoStation(
    @Param('stationId')
    stationId: string,
  ) {
    return this.stationsService
      .echoStation(
        stationId,
      );
  }

  @Get(':stationId')
  getStation(
    @Param('stationId')
    stationId: string,
  ) {
    return this.stationsService
      .getStation(
        stationId,
      );
  }

  @Post()
  createStation(
    @Body()
    dto:
      CreateRadiologyStationDto,
  ) {
    return this.stationsService
      .createStation(
        dto,
      );
  }

  @Patch(':stationId')
  updateStation(
    @Param('stationId')
    stationId: string,

    @Body()
    dto:
      UpdateRadiologyStationDto,
  ) {
    return this.stationsService
      .updateStation(
        stationId,
        dto,
      );
  }

  /**
   * Soft delete:
   * keeps the FHIR Device for audit/history but marks it inactive.
   */
  @Delete(':stationId')
  deactivateStation(
    @Param('stationId')
    stationId: string,
  ) {
    return this.stationsService
      .deactivateStation(
        stationId,
      );
  }
}
