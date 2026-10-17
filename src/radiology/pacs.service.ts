import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  OrthancSeries,
  OrthancStudy,
} from './pacs.types';

@Injectable()
export class PacsService {
  private readonly orthancUrl =
    process.env.ORTHANC_URL?.replace(/\/+$/, '') ??
    'http://localhost:8042';

  private readonly dicomWebPath =
    process.env.ORTHANC_DICOMWEB_PATH ??
    '/dicom-web';

  async getSystemStatus() {
    const system =
      await this.orthancRequest<Record<string, unknown>>(
        '/system',
      );

    return {
      connected: true,
      orthancUrl: this.orthancUrl,
      dicomWebUrl:
        `${this.orthancUrl}${this.dicomWebPath}`,
      system,
    };
  }

  async listStudies() {
    const ids =
      await this.orthancRequest<string[]>(
        '/studies',
      );

    const studies =
      await Promise.all(
        ids.map((id) =>
          this.getStudy(id),
        ),
      );

    return {
      count: studies.length,
      studies,
    };
  }

  async getStudy(
    orthancStudyId: string,
  ) {
    const study =
      await this.orthancRequest<OrthancStudy>(
        `/studies/${encodeURIComponent(
          orthancStudyId,
        )}`,
      );

    const seriesIds =
      study.Series ?? [];

    const series =
      await Promise.all(
        seriesIds.map((id) =>
          this.getSeries(id),
        ),
      );

    return this.mapStudy(
      study,
      series,
    );
  }

  async findStudyByUid(
    studyInstanceUid: string,
  ) {
    if (!studyInstanceUid?.trim()) {
      throw new BadRequestException(
        'studyInstanceUid is required.',
      );
    }

    const matches =
      await this.orthancRequest<string[]>(
        '/tools/find',
        {
          method: 'POST',
          body: JSON.stringify({
            Level: 'Study',
            Query: {
              StudyInstanceUID:
                studyInstanceUid.trim(),
            },
          }),
        },
      );

    if (!matches.length) {
      throw new NotFoundException(
        `PACS study ${studyInstanceUid} was not found.`,
      );
    }

    return this.getStudy(
      matches[0],
    );
  }

  async findStudiesByAccessionNumber(
    accessionNumber: string,
  ) {
    const accession =
      accessionNumber?.trim();

    if (!accession) {
      throw new BadRequestException(
        'accessionNumber is required.',
      );
    }

    const matches =
      await this.orthancRequest<string[]>(
        '/tools/find',
        {
          method: 'POST',
          body: JSON.stringify({
            Level: 'Study',
            Query: {
              AccessionNumber:
                accession,
            },
          }),
        },
      );

    const studies =
      await Promise.all(
        matches.map((id) =>
          this.getStudy(id),
        ),
      );

    return studies.sort(
      (a, b) =>
        this.studyDateKey(b)
          .localeCompare(
            this.studyDateKey(a),
          ),
    );
  }

  async findStudyByAccessionNumber(
    accessionNumber: string,
  ) {
    const studies =
      await this.findStudiesByAccessionNumber(
        accessionNumber,
      );

    if (!studies.length) {
      throw new NotFoundException(
        `PACS study with accession ${accessionNumber} was not found.`,
      );
    }

    return studies[0];
  }

  async getSeries(
    orthancSeriesId: string,
  ) {
    return this.orthancRequest<OrthancSeries>(
      `/series/${encodeURIComponent(
        orthancSeriesId,
      )}`,
    );
  }

  getViewerStudyUrl(
    studyInstanceUid: string,
  ) {
    const viewerBase =
      process.env.OHIF_VIEWER_URL ??
      'http://localhost:3001';

    return (
      `${viewerBase.replace(/\/+$/, '')}` +
      `/viewer?StudyInstanceUIDs=` +
      encodeURIComponent(
        studyInstanceUid,
      )
    );
  }

  private mapStudy(
    study: OrthancStudy,
    series: OrthancSeries[],
  ) {
    const tags =
      study.MainDicomTags ?? {};

    const patientTags =
      study.PatientMainDicomTags ?? {};

    const studyInstanceUid =
      tags.StudyInstanceUID;

    return {
      orthancStudyId: study.ID,
      studyInstanceUid,
      accessionNumber:
        tags.AccessionNumber,
      patientId:
        patientTags.PatientID,
      patientName:
        patientTags.PatientName,
      studyDate:
        tags.StudyDate,
      studyTime:
        tags.StudyTime,
      studyDescription:
        tags.StudyDescription,
      modalities:
        this.modalities(
          tags.ModalitiesInStudy,
          series,
        ),
      numberOfSeries:
        series.length,
      numberOfInstances:
        series.reduce(
          (total, item) =>
            total +
            (item.Instances?.length ??
              0),
          0,
        ),
      series:
        series.map((item) => ({
          orthancSeriesId:
            item.ID,
          seriesInstanceUid:
            item.MainDicomTags
              ?.SeriesInstanceUID,
          seriesNumber:
            this.toNumber(
              item.MainDicomTags
                ?.SeriesNumber,
            ),
          modality:
            item.MainDicomTags
              ?.Modality,
          description:
            item.MainDicomTags
              ?.SeriesDescription,
          bodyPartExamined:
            item.MainDicomTags
              ?.BodyPartExamined,
          numberOfInstances:
            item.Instances
              ?.length ?? 0,
        })),
      dicomWebStudyUrl:
        studyInstanceUid
          ? `${this.orthancUrl}${this.dicomWebPath}/studies/${encodeURIComponent(
              studyInstanceUid,
            )}`
          : undefined,
      viewerUrl:
        studyInstanceUid
          ? this.getViewerStudyUrl(
              studyInstanceUid,
            )
          : undefined,
    };
  }

  private modalities(
    modalitiesInStudy:
      string | undefined,
    series: OrthancSeries[],
  ) {
    const values =
      new Set<string>();

    if (modalitiesInStudy) {
      for (
        const modality of
        modalitiesInStudy.split('\\')
      ) {
        if (modality.trim()) {
          values.add(
            modality.trim(),
          );
        }
      }
    }

    for (const item of series) {
      const modality =
        item.MainDicomTags
          ?.Modality;

      if (modality) {
        values.add(modality);
      }
    }

    return [...values];
  }

  private studyDateKey(
    study: {
      studyDate?: string;
      studyTime?: string;
    },
  ) {
    return (
      `${study.studyDate ?? ''}` +
      `${study.studyTime ?? ''}`
    );
  }

  private toNumber(
    value: string | undefined,
  ) {
    if (!value) {
      return undefined;
    }

    const parsed =
      Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : undefined;
  }

  private async orthancRequest<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(
        `${this.orthancUrl}${path}`,
        {
          ...init,
          headers: {
            Accept:
              'application/json',
            'Content-Type':
              'application/json',
            ...(init?.headers ?? {}),
          },
        },
      );
    } catch {
      throw new BadGatewayException(
        `Unable to connect to Orthanc PACS at ${this.orthancUrl}.`,
      );
    }

    if (!response.ok) {
      const message =
        await response.text();

      if (
        response.status === 404
      ) {
        throw new NotFoundException(
          message ||
            'PACS resource was not found.',
        );
      }

      throw new BadGatewayException(
        `Orthanc returned HTTP ${response.status}: ${
          message ||
          response.statusText
        }`,
      );
    }

    return (await response.json()) as T;
  }
}
