import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { ImagingStudyService } from './imaging-study.service';

import { PacsService } from './pacs.service';

import { RadiologyService } from './radiology.service';

import { SyncPacsStudyDto } from './dto/sync-pacs-study.dto';

type PacsStudy = Awaited<ReturnType<PacsService['getStudy']>>;

@Injectable()
export class PacsSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PacsSyncService.name);

  private autoSyncTimer?: ReturnType<typeof setInterval>;

  private autoSyncRunning = false;

  constructor(
    private readonly pacsService: PacsService,

    private readonly imagingStudyService: ImagingStudyService,

    private readonly radiologyService: RadiologyService,
  ) {}

  onModuleInit() {
    const configured = Number(
      process.env.PACS_AUTO_SYNC_INTERVAL_MS ?? '15000',
    );

    if (!Number.isFinite(configured) || configured <= 0) {
      this.logger.log('PACS automatic synchronization is disabled.');
      return;
    }

    const interval = Math.max(configured, 5000);

    this.logger.log(
      `PACS automatic synchronization enabled every ${interval} ms.`,
    );

    this.autoSyncTimer = setInterval(() => {
      void this.runAutomaticScan();
    }, interval);

    void this.runAutomaticScan();
  }

  onModuleDestroy() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
    }
  }

  async syncByStudyInstanceUid(
    studyInstanceUid: string,
    dto: SyncPacsStudyDto,
  ) {
    if (!studyInstanceUid?.trim()) {
      throw new BadRequestException('studyInstanceUid is required.');
    }

    const pacsStudy = await this.pacsService.findStudyByUid(studyInstanceUid);

    return this.syncPacsStudy(pacsStudy, dto);
  }

  async syncByAccessionNumber(accessionNumber: string) {
    const accession = accessionNumber?.trim();

    if (!accession) {
      throw new BadRequestException('accessionNumber is required.');
    }

    const order = await this.radiologyService.getOrderByAccession(accession);

    if (!order.patientId || !order.hospitalId) {
      throw new BadRequestException(
        'Matched radiology order is missing patient or hospital context.',
      );
    }

    const pacsStudies =
      await this.pacsService.findStudiesByAccessionNumber(accession);

    if (pacsStudies.length === 0) {
      throw new NotFoundException(
        `No PACS study was found for accession ${accession}.`,
      );
    }

    const results: unknown[] = [];

    for (const pacsStudy of pacsStudies) {
      results.push(
        await this.syncPacsStudy(pacsStudy, {
          patientId: order.patientId,
          hospitalId: order.hospitalId,
          encounterId: order.encounterId,
          orderId: order.id,
          accessionNumber: accession,
        }),
      );
    }

    return {
      accessionNumber: accession,
      orderId: order.id,
      studiesFound: pacsStudies.length,
      results,
    };
  }

  async syncAvailableStudies() {
    const pacs = await this.pacsService.listStudies();

    const results: unknown[] = [];

    let matched = 0;
    let created = 0;
    let existing = 0;
    let skipped = 0;
    let failed = 0;

    for (const study of pacs.studies) {
      const accession = study.accessionNumber?.trim();

      if (!accession || !study.studyInstanceUid) {
        skipped += 1;
        continue;
      }

      try {
        const order =
          await this.radiologyService.getOrderByAccession(accession);

        if (!order.patientId || !order.hospitalId) {
          skipped += 1;
          continue;
        }

        matched += 1;

        const result = await this.syncPacsStudy(study, {
          patientId: order.patientId,
          hospitalId: order.hospitalId,
          encounterId: order.encounterId,
          orderId: order.id,
          accessionNumber: accession,
        });

        if (result.created) {
          created += 1;
        } else {
          existing += 1;
        }

        results.push(result);
      } catch (error) {
        if (error instanceof NotFoundException) {
          skipped += 1;
          continue;
        }

        failed += 1;

        results.push({
          created: false,
          accessionNumber: accession,
          studyInstanceUid: study.studyInstanceUid,
          error: this.errorMessage(error),
        });
      }
    }

    return {
      scanned: pacs.count,
      matched,
      created,
      existing,
      skipped,
      failed,
      results,
    };
  }

  async syncAllForPatient(patientId: string, hospitalId: string) {
    if (!patientId?.trim()) {
      throw new BadRequestException('patientId is required.');
    }

    if (!hospitalId?.trim()) {
      throw new BadRequestException('hospitalId is required.');
    }

    const pacs = await this.pacsService.listStudies();

    const results: unknown[] = [];

    for (const study of pacs.studies) {
      if (!study.studyInstanceUid) {
        continue;
      }

      if (study.accessionNumber) {
        try {
          const order = await this.radiologyService.getOrderByAccession(
            study.accessionNumber,
          );

          if (order.patientId === patientId) {
            results.push(
              await this.syncPacsStudy(study, {
                patientId,
                hospitalId: order.hospitalId ?? hospitalId,
                encounterId: order.encounterId,
                orderId: order.id,
                accessionNumber: study.accessionNumber,
              }),
            );

            continue;
          }
        } catch (error) {
          if (!(error instanceof NotFoundException)) {
            throw error;
          }
        }
      }

      if (study.patientId !== patientId) {
        continue;
      }

      results.push(
        await this.syncPacsStudy(study, {
          patientId,
          hospitalId,
        }),
      );
    }

    return {
      patientId,
      matchedStudies: results.length,
      results,
    };
  }

  private async syncPacsStudy(pacsStudy: PacsStudy, dto: SyncPacsStudyDto) {
    const studyInstanceUid = pacsStudy.studyInstanceUid?.trim();

    if (!studyInstanceUid) {
      throw new BadRequestException('PACS study has no StudyInstanceUID.');
    }

    const context = await this.resolveContext(pacsStudy, dto);

    const existing =
      await this.imagingStudyService.findByStudyInstanceUid(studyInstanceUid);

    if (existing) {
      if (context.orderId) {
        await this.radiologyService.updateWorkflowStatus(
          context.orderId,
          'acquired',
        );
      }

      return {
        created: false,
        message: 'FHIR ImagingStudy already exists.',
        accessionNumber: context.accessionNumber,
        orderId: context.orderId,
        pacsStudy,
        imagingStudy: existing,
      };
    }

    const modality =
      pacsStudy.modalities?.[0] ?? pacsStudy.series?.[0]?.modality ?? 'OT';

    const started = this.dicomDateTime(
      pacsStudy.studyDate,
      pacsStudy.studyTime,
    );

    const imagingStudy = await this.imagingStudyService.create({
      patientId: context.patientId,
      encounterId: context.encounterId,
      hospitalId: context.hospitalId,
      orderId: context.orderId,
      studyInstanceUid,
      accessionNumber: context.accessionNumber,
      status: 'available',
      modality,
      description: pacsStudy.studyDescription,
      started,
      numberOfSeries: pacsStudy.numberOfSeries,
      numberOfInstances: pacsStudy.numberOfInstances,
      pacsStudyUrl: pacsStudy.dicomWebStudyUrl,
      series: pacsStudy.series
        .filter((series) => Boolean(series.seriesInstanceUid))
        .map((series) => ({
          uid: series.seriesInstanceUid!,
          modality: series.modality ?? modality,
          description: series.description,
          number: series.seriesNumber,
          numberOfInstances: series.numberOfInstances,
        })),
      notes: `Synchronized from Orthanc study ${pacsStudy.orthancStudyId}`,
    });

    if (context.orderId) {
      await this.radiologyService.updateWorkflowStatus(
        context.orderId,
        'acquired',
      );
    }

    return {
      created: true,
      message: 'PACS study synchronized to FHIR ImagingStudy.',
      accessionNumber: context.accessionNumber,
      orderId: context.orderId,
      pacsStudy,
      imagingStudy,
    };
  }

  private async resolveContext(pacsStudy: PacsStudy, dto: SyncPacsStudyDto) {
    const pacsAccession = pacsStudy.accessionNumber?.trim();

    const requestedAccession = dto.accessionNumber?.trim();

    if (
      pacsAccession &&
      requestedAccession &&
      pacsAccession !== requestedAccession
    ) {
      throw new BadRequestException(
        'PACS accession number does not match the requested accession number.',
      );
    }

    const accessionNumber = requestedAccession ?? pacsAccession;

    let order: Awaited<ReturnType<RadiologyService['getOrder']>> | undefined;

    if (dto.orderId) {
      order = await this.radiologyService.getOrder(dto.orderId);
    } else if (accessionNumber) {
      try {
        order =
          await this.radiologyService.getOrderByAccession(accessionNumber);
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          throw error;
        }
      }
    }

    if (
      order?.accessionNumber &&
      pacsAccession &&
      order.accessionNumber !== pacsAccession
    ) {
      throw new BadRequestException(
        'PACS accession number does not match the selected radiology order.',
      );
    }

    if (
      order?.patientId &&
      dto.patientId &&
      order.patientId !== dto.patientId
    ) {
      throw new BadRequestException(
        'Selected radiology order belongs to another patient.',
      );
    }

    const patientId = order?.patientId ?? dto.patientId;

    const hospitalId = order?.hospitalId ?? dto.hospitalId;

    const encounterId = order?.encounterId ?? dto.encounterId;

    const orderId = order?.id ?? dto.orderId;

    if (!patientId) {
      throw new BadRequestException(
        'Unable to determine patientId. Provide it or use a valid accession number.',
      );
    }

    if (!hospitalId) {
      throw new BadRequestException(
        'Unable to determine hospitalId. Provide it or use a valid accession number.',
      );
    }

    return {
      patientId,
      hospitalId,
      encounterId,
      orderId,
      accessionNumber: order?.accessionNumber ?? accessionNumber,
    };
  }

  private async runAutomaticScan() {
    if (this.autoSyncRunning) {
      return;
    }

    this.autoSyncRunning = true;

    try {
      const result = await this.syncAvailableStudies();

      if (result.created > 0) {
        this.logger.log(
          `PACS auto-sync created ${result.created} ImagingStudy resource(s).`,
        );
      }
    } catch (error) {
      this.logger.debug(`PACS auto-sync skipped: ${this.errorMessage(error)}`);
    } finally {
      this.autoSyncRunning = false;
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  private dicomDateTime(date?: string, time?: string) {
    if (!date || !/^\d{8}$/.test(date)) {
      return undefined;
    }

    const year = date.slice(0, 4);
    const month = date.slice(4, 6);
    const day = date.slice(6, 8);

    if (!time || !/^\d{2}/.test(time)) {
      return `${year}-${month}-${day}`;
    }

    const clean = time.replace(/[^0-9.]/g, '');

    const hour = clean.slice(0, 2) || '00';

    const minute = clean.slice(2, 4) || '00';

    const second = clean.slice(4, 6) || '00';

    return `${year}-${month}-${day}` + `T${hour}:${minute}:${second}`;
  }
}
