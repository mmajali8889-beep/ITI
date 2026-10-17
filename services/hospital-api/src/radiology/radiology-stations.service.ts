import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Device, Extension } from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';

import { CreateRadiologyStationDto } from './dto/create-radiology-station.dto';

import { UpdateRadiologyStationDto } from './dto/update-radiology-station.dto';

import { OrthancModalityRegistryService } from './orthanc-modality-registry.service';

const STATION_TYPE_SYSTEM =
  'http://hospital-ehr.local/fhir/CodeSystem/device-types';

const STATION_TYPE_CODE = 'radiology-modality-station';

const DICOM_AET_IDENTIFIER_SYSTEM =
  'http://hospital-ehr.local/fhir/NamingSystem/dicom-ae-title';

const MODALITY_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-station-modality';

const IP_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-station-ip';

const PORT_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-station-port';

const ROOM_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-station-room';

const ALLOWED_MODALITIES = [
  'XR',
  'DX',
  'CT',
  'MR',
  'US',
  'MG',
  'NM',
  'PT',
  'OTHER',
] as const;

export type RadiologyStationView = {
  id: string;
  hospitalId: string;
  name: string;
  modality: (typeof ALLOWED_MODALITIES)[number];
  aet: string;
  ipAddress?: string;
  port?: number;
  room?: string;
  active: boolean;
  updatedAt?: string;
};

@Injectable()
export class RadiologyStationsService {
  constructor(
    private readonly medplumService: MedplumService,

    private readonly orthancRegistry: OrthancModalityRegistryService,
  ) {}

  async listStations(
    filters: {
      hospitalId?: string;
      modality?: string;
      active?: boolean;
    } = {},
  ) {
    const hospitalId = filters.hospitalId?.trim();

    const modality = filters.modality?.trim().toUpperCase();

    if (
      modality &&
      !ALLOWED_MODALITIES.includes(
        modality as (typeof ALLOWED_MODALITIES)[number],
      )
    ) {
      throw new BadRequestException('Invalid radiology station modality.');
    }

    const devices = await this.medplumService
      .getClient()
      .searchResources('Device', {
        _count: '1000',
      });

    const stations = devices
      .filter((device) => this.isRadiologyStation(device))
      .map((device) => this.mapStation(device))
      .filter((station) => {
        if (hospitalId && station.hospitalId !== hospitalId) {
          return false;
        }

        if (modality && station.modality !== modality) {
          return false;
        }

        if (
          typeof filters.active === 'boolean' &&
          station.active !== filters.active
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const modalityCompare = a.modality.localeCompare(b.modality);

        if (modalityCompare !== 0) {
          return modalityCompare;
        }

        return a.name.localeCompare(b.name);
      });

    return {
      total: stations.length,
      filters: {
        hospitalId,
        modality,
        active: filters.active,
      },
      stations,
    };
  }

  async getStation(stationId: string): Promise<RadiologyStationView> {
    const device = await this.readStationDevice(stationId);

    return this.mapStation(device);
  }

  async createStation(dto: CreateRadiologyStationDto) {
    const normalized = this.normalizeCreateDto(dto);

    await this.assertHospitalExists(normalized.hospitalId);

    await this.ensureUniqueAet(normalized.hospitalId, normalized.aet);

    const device: Device = {
      resourceType: 'Device',

      status: normalized.active ? 'active' : 'inactive',

      identifier: [
        {
          system: DICOM_AET_IDENTIFIER_SYSTEM,
          value: normalized.aet,
        },
      ],

      deviceName: [
        {
          name: normalized.name,
          type: 'user-friendly-name',
        },
      ],

      type: {
        coding: [
          {
            system: STATION_TYPE_SYSTEM,
            code: STATION_TYPE_CODE,
            display: 'Radiology Modality Station',
          },
        ],
        text: 'Radiology Modality Station',
      },

      owner: {
        reference: `Organization/${normalized.hospitalId}`,
      },

      extension: this.stationExtensions(normalized),
    };

    const created = await this.medplumService
      .getClient()
      .createResource(device);

    const station = this.mapStation(created);

    return {
      ...station,
      orthanc: await this.trySyncOrthanc(station),
    };
  }

  async updateStation(stationId: string, dto: UpdateRadiologyStationDto) {
    const current = await this.readStationDevice(stationId);

    const currentView = this.mapStation(current);

    const merged = this.normalizeCreateDto({
      hospitalId: dto.hospitalId ?? currentView.hospitalId,

      name: dto.name ?? currentView.name,

      modality: dto.modality ?? currentView.modality,

      aet: dto.aet ?? currentView.aet,

      ipAddress: dto.ipAddress ?? currentView.ipAddress,

      port: dto.port ?? currentView.port,

      room: dto.room ?? currentView.room,

      active: dto.active ?? currentView.active,
    });

    if (merged.hospitalId !== currentView.hospitalId) {
      await this.assertHospitalExists(merged.hospitalId);
    }

    await this.ensureUniqueAet(merged.hospitalId, merged.aet, stationId);

    const updated: Device = {
      ...current,

      status: merged.active ? 'active' : 'inactive',

      identifier: [
        ...(current.identifier ?? []).filter(
          (identifier) => identifier.system !== DICOM_AET_IDENTIFIER_SYSTEM,
        ),

        {
          system: DICOM_AET_IDENTIFIER_SYSTEM,
          value: merged.aet,
        },
      ],

      deviceName: [
        {
          name: merged.name,
          type: 'user-friendly-name',
        },
      ],

      owner: {
        reference: `Organization/${merged.hospitalId}`,
      },

      extension: [
        ...(current.extension ?? []).filter(
          (extension) => !this.isStationExtension(extension.url),
        ),

        ...this.stationExtensions(merged),
      ],
    };

    const saved = await this.medplumService.getClient().updateResource(updated);

    const station = this.mapStation(saved);

    return {
      ...station,
      orthanc: await this.trySyncOrthanc(station),
    };
  }

  async deactivateStation(stationId: string) {
    const station = await this.updateStation(stationId, {
      active: false,
    });

    return station;
  }

  async syncStationToOrthanc(stationId: string) {
    const station = await this.getStation(stationId);

    return this.orthancRegistry.registerStation(station);
  }

  async getStationOrthancStatus(stationId: string) {
    const station = await this.getStation(stationId);

    return this.orthancRegistry.getRegistryStatus(station);
  }

  async echoStation(stationId: string) {
    const station = await this.getStation(stationId);

    return this.orthancRegistry.echoStation(station);
  }

  async syncHospitalStations(hospitalId: string) {
    const result = await this.listStations({
      hospitalId: hospitalId?.trim(),
    });

    const synced: unknown[] = [];

    for (const station of result.stations) {
      if (!station.active) {
        try {
          synced.push(await this.orthancRegistry.unregisterStation(station));
        } catch (error) {
          synced.push({
            stationId: station.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        continue;
      }

      try {
        synced.push({
          stationId: station.id,

          stationName: station.name,

          ...(await this.orthancRegistry.registerStation(station)),
        });
      } catch (error) {
        synced.push({
          stationId: station.id,

          stationName: station.name,

          success: false,

          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      hospitalId,
      total: result.stations.length,
      results: synced,
    };
  }

  private async trySyncOrthanc(station: RadiologyStationView) {
    try {
      if (!station.active) {
        return this.orthancRegistry.unregisterStation(station);
      }

      if (!station.ipAddress || !station.port) {
        return {
          registered: false,
          skipped: true,
          reason:
            'IP/hostname and DICOM port are required for Orthanc registration.',
        };
      }

      return this.orthancRegistry.registerStation(station);
    } catch (error) {
      return {
        registered: false,
        syncFailed: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private normalizeCreateDto(dto: CreateRadiologyStationDto) {
    const hospitalId = dto.hospitalId?.trim();

    const name = dto.name?.trim();

    const modality = dto.modality?.trim().toUpperCase();

    const aet = dto.aet?.trim().toUpperCase();

    const ipAddress = dto.ipAddress?.trim() || undefined;

    const room = dto.room?.trim() || undefined;

    const port =
      dto.port === undefined || dto.port === null
        ? undefined
        : Number(dto.port);

    if (!hospitalId) {
      throw new BadRequestException('hospitalId is required.');
    }

    if (!name) {
      throw new BadRequestException('Station name is required.');
    }

    if (name.length > 16) {
      throw new BadRequestException(
        'Station name cannot exceed 16 characters because it is used as DICOM ScheduledStationName.',
      );
    }

    if (
      !modality ||
      !ALLOWED_MODALITIES.includes(
        modality as (typeof ALLOWED_MODALITIES)[number],
      )
    ) {
      throw new BadRequestException(
        `modality must be one of: ${ALLOWED_MODALITIES.join(', ')}`,
      );
    }

    if (!aet) {
      throw new BadRequestException('DICOM AE Title is required.');
    }

    if (aet.length > 16) {
      throw new BadRequestException(
        'DICOM AE Title cannot exceed 16 characters.',
      );
    }

    if (!/^[\x20-\x7E]+$/.test(aet) || aet.includes('\\')) {
      throw new BadRequestException(
        'DICOM AE Title must contain printable ASCII characters and cannot contain a backslash.',
      );
    }

    if (
      port !== undefined &&
      (!Number.isInteger(port) || port < 1 || port > 65535)
    ) {
      throw new BadRequestException(
        'DICOM port must be an integer from 1 to 65535.',
      );
    }

    return {
      hospitalId,
      name,
      modality: modality as (typeof ALLOWED_MODALITIES)[number],
      aet,
      ipAddress,
      port,
      room,
      active: dto.active !== false,
    };
  }

  private async ensureUniqueAet(
    hospitalId: string,
    aet: string,
    excludeId?: string,
  ) {
    const result = await this.listStations({
      hospitalId,
    });

    const duplicate = result.stations.find(
      (station) =>
        station.id !== excludeId &&
        station.aet.toUpperCase() === aet.toUpperCase(),
    );

    if (duplicate) {
      throw new BadRequestException(
        `AE Title ${aet} is already configured for this hospital.`,
      );
    }
  }

  private async assertHospitalExists(hospitalId: string) {
    try {
      await this.medplumService
        .getClient()
        .readResource('Organization', hospitalId);
    } catch {
      throw new BadRequestException(
        `Hospital Organization ${hospitalId} was not found.`,
      );
    }
  }

  private async readStationDevice(stationId: string): Promise<Device> {
    const id = stationId?.trim();

    if (!id) {
      throw new BadRequestException('stationId is required.');
    }

    let device: Device;

    try {
      device = await this.medplumService.getClient().readResource('Device', id);
    } catch {
      throw new NotFoundException(`Radiology station ${id} was not found.`);
    }

    if (!this.isRadiologyStation(device)) {
      throw new NotFoundException(
        `Device ${id} is not a radiology modality station.`,
      );
    }

    return device;
  }

  private isRadiologyStation(device: Device) {
    return Boolean(
      device.type?.coding?.some(
        (coding) =>
          coding.system === STATION_TYPE_SYSTEM &&
          coding.code === STATION_TYPE_CODE,
      ),
    );
  }

  private mapStation(device: Device): RadiologyStationView {
    const id = device.id;

    if (!id) {
      throw new BadRequestException('Radiology station Device has no ID.');
    }

    const hospitalId = this.referenceId(device.owner?.reference);

    if (!hospitalId) {
      throw new BadRequestException(
        `Radiology station ${id} has no hospital owner.`,
      );
    }

    const name =
      device.deviceName?.find((item) => item.type === 'user-friendly-name')
        ?.name ??
      device.deviceName?.[0]?.name ??
      'Imaging Station';

    const aet =
      device.identifier?.find(
        (identifier) => identifier.system === DICOM_AET_IDENTIFIER_SYSTEM,
      )?.value ?? '';

    const modality =
      this.extensionString(device, MODALITY_EXTENSION)?.toUpperCase() ??
      'OTHER';

    return {
      id,
      hospitalId,
      name,
      modality: modality as (typeof ALLOWED_MODALITIES)[number],
      aet,

      ipAddress: this.extensionString(device, IP_EXTENSION),

      port: this.extensionInteger(device, PORT_EXTENSION),

      room: this.extensionString(device, ROOM_EXTENSION),

      active: device.status === 'active',

      updatedAt: device.meta?.lastUpdated,
    };
  }

  private stationExtensions(value: {
    modality: string;
    ipAddress?: string;
    port?: number;
    room?: string;
  }): Extension[] {
    return [
      {
        url: MODALITY_EXTENSION,
        valueCode: value.modality,
      },

      ...(value.ipAddress
        ? [
            {
              url: IP_EXTENSION,
              valueString: value.ipAddress,
            },
          ]
        : []),

      ...(value.port !== undefined
        ? [
            {
              url: PORT_EXTENSION,
              valueInteger: value.port,
            },
          ]
        : []),

      ...(value.room
        ? [
            {
              url: ROOM_EXTENSION,
              valueString: value.room,
            },
          ]
        : []),
    ];
  }

  private isStationExtension(url?: string) {
    return [
      MODALITY_EXTENSION,
      IP_EXTENSION,
      PORT_EXTENSION,
      ROOM_EXTENSION,
    ].includes(url ?? '');
  }

  private extensionString(device: Device, url: string) {
    const extension = device.extension?.find((item) => item.url === url);

    return extension?.valueString ?? extension?.valueCode;
  }

  private extensionInteger(device: Device, url: string) {
    return device.extension?.find((item) => item.url === url)?.valueInteger;
  }

  private referenceId(reference?: string) {
    if (!reference) {
      return undefined;
    }

    const parts = reference.split('/');

    return parts[parts.length - 1];
  }
}
