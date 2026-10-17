import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import type { RadiologyStationView } from './radiology-stations.service';

type OrthancModalityConfiguration = {
  AET: string;
  Host: string;
  Port: number;
  Manufacturer: string;
  AllowEcho: boolean;
  AllowFind: boolean;
  AllowFindWorklist: boolean;
  AllowGet: boolean;
  AllowMove: boolean;
  AllowStore: boolean;
  AllowStorageCommitment: boolean;
  AllowTranscoding: boolean;
  UseDicomTls: boolean;
  Timeout: number;
};

@Injectable()
export class OrthancModalityRegistryService {
  private readonly orthancUrl =
    process.env.ORTHANC_URL?.replace(/\/+$/, '') ?? 'http://localhost:8042';

  private readonly username = process.env.ORTHANC_USERNAME?.trim();

  private readonly password = process.env.ORTHANC_PASSWORD ?? '';

  async getRegistryStatus(station: RadiologyStationView) {
    const orthancId = this.orthancId(station.id);

    try {
      const configuration = await this.request<OrthancModalityConfiguration>(
        `/modalities/${encodeURIComponent(orthancId)}/configuration`,
      );

      return {
        registered: true,
        orthancId,
        configuration,
      };
    } catch (error) {
      if (this.isHttpStatus(error, 404)) {
        return {
          registered: false,
          orthancId,
        };
      }

      throw error;
    }
  }

  async registerStation(station: RadiologyStationView) {
    this.validateStationForOrthanc(station);

    const orthancId = this.orthancId(station.id);

    const configuration: OrthancModalityConfiguration = {
      AET: station.aet.trim().toUpperCase(),

      Host: station.ipAddress!.trim(),

      Port: station.port!,

      Manufacturer: 'Generic',

      AllowEcho: true,

      /**
       * Do not let modalities browse historical studies
       * unless this is explicitly needed later.
       */
      AllowFind: false,

      /**
       * Required for CT/MR/XR/US to retrieve the scheduled MWL.
       */
      AllowFindWorklist: true,

      AllowGet: false,

      AllowMove: false,

      /**
       * Required for the modality to send acquired images to Orthanc.
       */
      AllowStore: true,

      AllowStorageCommitment: false,

      AllowTranscoding: true,

      UseDicomTls: false,

      Timeout: 10,
    };

    await this.request(`/modalities/${encodeURIComponent(orthancId)}`, {
      method: 'PUT',

      body: JSON.stringify(configuration),
    });

    return {
      registered: true,
      orthancId,
      configuration,
    };
  }

  async unregisterStation(station: RadiologyStationView) {
    const orthancId = this.orthancId(station.id);

    try {
      await this.request(`/modalities/${encodeURIComponent(orthancId)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      if (!this.isHttpStatus(error, 404)) {
        throw error;
      }
    }

    return {
      registered: false,
      orthancId,
    };
  }

  async echoStation(station: RadiologyStationView) {
    /**
     * Re-register first so C-ECHO always uses the latest
     * AE Title / host / port from the FHIR Device.
     */
    const registry = await this.registerStation(station);

    const startedAt = Date.now();

    const response = await this.request<unknown>(
      `/modalities/${encodeURIComponent(registry.orthancId)}/echo`,
      {
        method: 'POST',

        body: JSON.stringify({
          Timeout: 10,
        }),
      },
    );

    return {
      success: true,

      orthancId: registry.orthancId,

      aet: station.aet,

      host: station.ipAddress,

      port: station.port,

      elapsedMs: Date.now() - startedAt,

      response,
    };
  }

  async listRegisteredModalities() {
    return this.request<unknown>('/modalities?expand');
  }

  private validateStationForOrthanc(station: RadiologyStationView) {
    if (!station.active) {
      throw new BadRequestException(
        'Inactive radiology stations cannot be registered in Orthanc.',
      );
    }

    if (!station.aet?.trim()) {
      throw new BadRequestException('Station AE Title is required.');
    }

    if (!station.ipAddress?.trim()) {
      throw new BadRequestException(
        'Station IP address or hostname is required before Orthanc registration.',
      );
    }

    if (!station.port || station.port < 1 || station.port > 65535) {
      throw new BadRequestException(
        'A valid DICOM port is required before Orthanc registration.',
      );
    }
  }

  private orthancId(stationId: string) {
    const safe = stationId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);

    return `ehr-${safe}`;
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), 15000);

    const headers = new Headers(init.headers);

    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    if (this.username) {
      const token = Buffer.from(`${this.username}:${this.password}`).toString(
        'base64',
      );

      headers.set('Authorization', `Basic ${token}`);
    }

    try {
      const response = await fetch(`${this.orthancUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        const error = new BadGatewayException(
          `Orthanc ${response.status}: ${text || response.statusText}`,
        ) as BadGatewayException & {
          orthancStatus?: number;
        };

        error.orthancStatus = response.status;

        throw error;
      }

      if (!text) {
        return undefined as T;
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);

      throw new BadGatewayException(
        `Unable to communicate with Orthanc at ${this.orthancUrl}: ${message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private isHttpStatus(error: unknown, status: number) {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'orthancStatus' in error &&
      (
        error as {
          orthancStatus?: number;
        }
      ).orthancStatus === status,
    );
  }
}
