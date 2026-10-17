import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Medication,
  MedicationDispense,
  MedicationRequest,
  MedicationAdministration,
  Encounter,
  Patient,
} from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { MedplumService } from '../medplum/medplum.service';
import {
  DispenseDto,
  ReceiveStockDto,
  ReturnDispenseDto,
  VerifyPrescriptionDto,
  AdministerMedicationDto,
} from './dto/pharmacy.dto';
const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition/';
const HOSPITAL = `${BASE}pharmacy-hospital`,
  STOCK = `${BASE}stock-quantity`,
  REORDER = `${BASE}reorder-level`,
  UNIT = `${BASE}stock-unit`,
  RETURNED = `${BASE}returned-quantity`,
  ALLOCATIONS = `${BASE}batch-allocations`,
  RETURN_LOG = `${BASE}return-log`;
const VERIFICATION = `${BASE}pharmacy-verification`,
  COUNSELING = `${BASE}patient-counseling`,
  WARD = `${BASE}ward-supply`;
@Injectable()
export class PharmacyService {
  constructor(private readonly medplumService: MedplumService) {}
  async receive(dto: ReceiveStockDto) {
    for (const key of [
      'hospitalId',
      'medicationCode',
      'medicationName',
      'form',
      'unit',
      'lotNumber',
      'expirationDate',
    ] as const)
      if (!String(dto[key] ?? '').trim())
        throw new BadRequestException(`${key} is required`);
    if (!Number.isInteger(Number(dto.quantity)) || dto.quantity <= 0)
      throw new BadRequestException('Quantity must be a positive whole number');
    if (!Number.isFinite(Number(dto.reorderLevel)) || dto.reorderLevel < 0)
      throw new BadRequestException('Invalid reorder level');
    const expiry = new Date(dto.expirationDate);
    if (Number.isNaN(expiry.getTime()) || expiry <= new Date())
      throw new BadRequestException('Expiration date must be in the future');
    const medplum = this.medplumService.getClient();
    const all = await medplum.searchResources('Medication', { _count: '500' });
    const duplicate = all.find(
      (item) =>
        this.hospitalId(item) === dto.hospitalId &&
        item.code?.coding?.[0]?.code === dto.medicationCode.trim() &&
        item.batch?.lotNumber === dto.lotNumber.trim(),
    );
    if (duplicate)
      throw new ConflictException(
        'Lot number already exists for this medication',
      );
    const resource: Medication = {
      resourceType: 'Medication',
      status: 'active',
      identifier: [
        {
          system: `https://hospital-ehr.local/formulary/${dto.hospitalId}`,
          value: `MED-${randomUUID().slice(0, 8).toUpperCase()}`,
        },
      ],
      code: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/medication',
            code: dto.medicationCode.trim(),
            display: dto.medicationName.trim(),
          },
        ],
        text: dto.medicationName.trim(),
      },
      form: { text: dto.form.trim() },
      batch: {
        lotNumber: dto.lotNumber.trim(),
        expirationDate: expiry.toISOString(),
      },
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${dto.hospitalId}` },
        },
        { url: STOCK, valueInteger: Number(dto.quantity) },
        { url: REORDER, valueInteger: Number(dto.reorderLevel) },
        { url: UNIT, valueString: dto.unit.trim() },
        ...(dto.strength?.trim()
          ? [
              {
                url: `${BASE}medication-strength`,
                valueString: dto.strength.trim(),
              },
            ]
          : []),
      ],
    };
    return this.mapStock(await medplum.createResource<Medication>(resource));
  }
  async inventory(hospitalId: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const resources = await this.medplumService
      .getClient()
      .searchResources('Medication', { _count: '500' });
    const batches = resources
      .filter(
        (item) =>
          this.hospitalId(item) === hospitalId && item.status === 'active',
      )
      .map((item) => this.mapStock(item))
      .sort((a, b) =>
        (a.expirationDate ?? '').localeCompare(b.expirationDate ?? ''),
      );
    const grouped = new Map<string, typeof batches>();
    for (const batch of batches) {
      const list = grouped.get(batch.medicationCode ?? '') ?? [];
      list.push(batch);
      grouped.set(batch.medicationCode ?? '', list);
    }
    const formulary = [...grouped.values()].map((items) => ({
      medicationCode: items[0].medicationCode,
      medicationName: items[0].medicationName,
      form: items[0].form,
      strength: items[0].strength,
      unit: items[0].unit,
      totalStock: items.reduce((sum, item) => sum + item.quantity, 0),
      reorderLevel: Math.max(...items.map((item) => item.reorderLevel)),
      lowStock:
        items.reduce((sum, item) => sum + item.quantity, 0) <=
        Math.max(...items.map((item) => item.reorderLevel)),
      batches: items,
    }));
    return {
      totalItems: formulary.length,
      totalUnits: formulary.reduce((sum, item) => sum + item.totalStock, 0),
      lowStock: formulary.filter((item) => item.lowStock).length,
      expiringSoon: batches.filter(
        (item) =>
          item.expirationDate &&
          new Date(item.expirationDate).getTime() < Date.now() + 90 * 86400000,
      ).length,
      formulary,
    };
  }
  async queue(hospitalId: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const medplum = this.medplumService.getClient();
    const [requests, dispenses] = await Promise.all([
      medplum.searchResources('MedicationRequest', {
        status: 'active',
        _count: '500',
      }),
      medplum.searchResources('MedicationDispense', { _count: '500' }),
    ]);
    const dispensed = new Map<string, number>();
    for (const item of dispenses) {
      if (
        this.dispenseHospitalId(item) !== hospitalId ||
        item.status !== 'completed'
      )
        continue;
      const id = item.authorizingPrescription?.[0]?.reference?.replace(
        'MedicationRequest/',
        '',
      );
      if (id)
        dispensed.set(
          id,
          (dispensed.get(id) ?? 0) +
            (item.quantity?.value ?? 0) -
            this.returned(item),
        );
    }
    const rows = await Promise.all(
      requests
        .filter((item) => this.requestHospitalId(item) === hospitalId)
        .map(async (item) => {
          let patientName = item.subject?.display;
          const patientId = item.subject?.reference?.replace('Patient/', '');
          if (!patientName && patientId) {
            try {
              const patient = await medplum.readResource('Patient', patientId);
              patientName = patient.name?.[0]?.text;
            } catch {
              patientName = undefined;
            }
          }
          const prescribed = item.dispenseRequest?.quantity?.value ?? 0,
            issued = dispensed.get(item.id ?? '') ?? 0;
          return {
            ...this.mapRequest(item),
            patientName,
            prescribedQuantity: prescribed,
            dispensedQuantity: issued,
            remainingQuantity: Math.max(0, prescribed - issued),
          };
        }),
    );
    return {
      total: rows.filter((item) => item.remainingQuantity > 0).length,
      requests: rows.filter((item) => item.remainingQuantity > 0),
    };
  }

  async verifyPrescription(id: string, dto: VerifyPrescriptionDto) {
    if (!dto.hospitalId || !dto.pharmacistName?.trim())
      throw new BadRequestException('Hospital and pharmacist are required');
    if (
      !['approved', 'rejected', 'clarification-required'].includes(dto.decision)
    )
      throw new BadRequestException('Invalid pharmacy verification decision');
    if (
      dto.decision === 'approved' &&
      (!dto.allergyChecked ||
        !dto.interactionChecked ||
        !dto.doseChecked ||
        !dto.stockChecked)
    ) {
      throw new BadRequestException(
        'Allergy, interaction, dose and stock checks are required before approval',
      );
    }
    if (dto.decision !== 'approved' && !dto.issues?.trim())
      throw new BadRequestException('Clinical issue details are required');
    const request = await this.readRequest(id, dto.hospitalId);
    if (this.verification(request)?.decision === 'approved')
      throw new ConflictException(
        'Prescription is already clinically verified',
      );
    const record = {
      decision: dto.decision,
      allergyChecked: dto.allergyChecked,
      interactionChecked: dto.interactionChecked,
      doseChecked: dto.doseChecked,
      stockChecked: dto.stockChecked,
      pharmacistId: dto.pharmacistId,
      pharmacistName: dto.pharmacistName.trim(),
      issues: dto.issues?.trim(),
      verifiedAt: new Date().toISOString(),
    };
    request.extension = [
      ...(request.extension ?? []).filter((item) => item.url !== VERIFICATION),
      { url: VERIFICATION, valueString: JSON.stringify(record) },
    ];
    if (dto.decision === 'rejected') request.status = 'stopped';
    else if (dto.decision === 'clarification-required')
      request.status = 'on-hold';
    await this.medplumService.getClient().updateResource(request);
    return { medicationRequestId: id, ...record };
  }

  async dispense(dto: DispenseDto) {
    if (
      !dto.hospitalId ||
      !dto.medicationRequestId ||
      !dto.pharmacistName?.trim()
    )
      throw new BadRequestException(
        'Hospital, prescription and pharmacist are required',
      );
    if (!Number.isInteger(Number(dto.quantity)) || dto.quantity <= 0)
      throw new BadRequestException(
        'Dispense quantity must be a positive whole number',
      );
    if (!dto.wardId && !dto.wardName && !dto.counselingProvided)
      throw new BadRequestException(
        'Patient counseling confirmation is required for outpatient dispensing',
      );
    const medplum = this.medplumService.getClient();
    let request: MedicationRequest;
    try {
      request = await medplum.readResource(
        'MedicationRequest',
        dto.medicationRequestId,
      );
    } catch {
      throw new NotFoundException('Prescription not found');
    }
    if (
      this.requestHospitalId(request) !== dto.hospitalId ||
      request.status !== 'active'
    )
      throw new NotFoundException('Active prescription not found');
    const verification = this.verification(request);
    if (verification?.decision !== 'approved')
      throw new ConflictException({
        message: 'Clinical pharmacy verification is required before dispensing',
        code: 'PHARMACY_VERIFICATION_REQUIRED',
      });
    const queue = await this.queue(dto.hospitalId);
    const row = queue.requests.find(
      (item) => item.id === dto.medicationRequestId,
    );
    if (!row || dto.quantity > row.remainingQuantity)
      throw new ConflictException(
        'Dispense quantity exceeds the remaining prescription quantity',
      );
    const code = request.medicationCodeableConcept?.coding?.[0]?.code;
    if (!code)
      throw new BadRequestException('Prescription medication code is missing');
    const stock = (
      await medplum.searchResources('Medication', { _count: '500' })
    )
      .filter(
        (item) =>
          this.hospitalId(item) === dto.hospitalId &&
          item.status === 'active' &&
          item.code?.coding?.[0]?.code === code &&
          this.stock(item) > 0 &&
          (!item.batch?.expirationDate ||
            new Date(item.batch.expirationDate) > new Date()),
      )
      .sort((a, b) =>
        (a.batch?.expirationDate ?? '').localeCompare(
          b.batch?.expirationDate ?? '',
        ),
      );
    if (stock.reduce((sum, item) => sum + this.stock(item), 0) < dto.quantity)
      throw new ConflictException({
        message: 'Insufficient pharmacy stock',
        code: 'INSUFFICIENT_STOCK',
      });
    let remaining = dto.quantity;
    const allocations: Array<{
      medicationId: string;
      lotNumber?: string;
      quantity: number;
    }> = [];
    for (const batch of stock) {
      if (!remaining) break;
      const take = Math.min(remaining, this.stock(batch));
      this.setInteger(batch, STOCK, this.stock(batch) - take);
      await medplum.updateResource(batch);
      allocations.push({
        medicationId: batch.id!,
        lotNumber: batch.batch?.lotNumber,
        quantity: take,
      });
      remaining -= take;
    }
    const dispense: MedicationDispense = {
      resourceType: 'MedicationDispense',
      status: 'completed',
      identifier: [
        {
          system: `https://hospital-ehr.local/dispense/${dto.hospitalId}`,
          value: `DSP-${randomUUID().slice(0, 8).toUpperCase()}`,
        },
      ],
      medicationCodeableConcept: request.medicationCodeableConcept,
      subject: request.subject,
      context: request.encounter,
      authorizingPrescription: [
        { reference: `MedicationRequest/${request.id}` },
      ],
      performer: [{ actor: { display: dto.pharmacistName.trim() } }],
      quantity: { value: dto.quantity, unit: row.quantityUnit },
      whenPrepared: new Date().toISOString(),
      whenHandedOver: new Date().toISOString(),
      dosageInstruction: request.dosageInstruction,
      note: dto.notes?.trim() ? [{ text: dto.notes.trim() }] : undefined,
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${dto.hospitalId}` },
        },
        { url: ALLOCATIONS, valueString: JSON.stringify(allocations) },
        { url: RETURNED, valueInteger: 0 },
        {
          url: COUNSELING,
          valueString: JSON.stringify({
            provided: dto.counselingProvided,
            notes: dto.counselingNotes?.trim(),
            at: new Date().toISOString(),
          }),
        },
        ...(dto.wardId || dto.wardName
          ? [
              {
                url: WARD,
                valueReference: dto.wardId
                  ? {
                      reference: `Location/${dto.wardId}`,
                      display: dto.wardName,
                    }
                  : { display: dto.wardName },
              },
            ]
          : []),
      ],
    };
    const created = await medplum.createResource<MedicationDispense>(dispense);
    if (dto.quantity === row.remainingQuantity) {
      request.status = 'completed';
      await medplum.updateResource(request);
    }
    return this.mapDispense(created);
  }
  async dispenses(hospitalId: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const items = (
      await this.medplumService
        .getClient()
        .searchResources('MedicationDispense', { _count: '500' })
    )
      .filter((item) => this.dispenseHospitalId(item) === hospitalId)
      .sort((a, b) =>
        (b.whenHandedOver ?? '').localeCompare(a.whenHandedOver ?? ''),
      )
      .map((item) => this.mapDispense(item));
    return { total: items.length, dispenses: items };
  }
  async returnDispense(id: string, dto: ReturnDispenseDto) {
    if (!dto.hospitalId || !dto.reason?.trim() || !dto.pharmacistName?.trim())
      throw new BadRequestException(
        'Hospital, return reason and pharmacist are required',
      );
    if (!Number.isInteger(Number(dto.quantity)) || dto.quantity <= 0)
      throw new BadRequestException('Return quantity must be positive');
    const medplum = this.medplumService.getClient();
    let dispense: MedicationDispense;
    try {
      dispense = await medplum.readResource('MedicationDispense', id);
    } catch {
      throw new NotFoundException('Dispense record not found');
    }
    if (this.dispenseHospitalId(dispense) !== dto.hospitalId)
      throw new NotFoundException('Dispense record not found');
    const available = (dispense.quantity?.value ?? 0) - this.returned(dispense);
    if (dto.quantity > available)
      throw new ConflictException('Return quantity exceeds dispensed quantity');
    const allocations = this.allocations(dispense);
    let remaining = dto.quantity;
    for (const allocation of allocations) {
      if (!remaining) break;
      const amount = Math.min(remaining, allocation.quantity);
      const medication = await medplum.readResource(
        'Medication',
        allocation.medicationId,
      );
      if (this.hospitalId(medication) !== dto.hospitalId)
        throw new NotFoundException('Stock batch not found');
      this.setInteger(medication, STOCK, this.stock(medication) + amount);
      await medplum.updateResource(medication);
      remaining -= amount;
    }
    this.setInteger(dispense, RETURNED, this.returned(dispense) + dto.quantity);
    dispense.extension = [
      ...(dispense.extension ?? []),
      {
        url: RETURN_LOG,
        valueString: JSON.stringify({
          quantity: dto.quantity,
          reason: dto.reason.trim(),
          pharmacistName: dto.pharmacistName.trim(),
          at: new Date().toISOString(),
        }),
      },
    ];
    return this.mapDispense(await medplum.updateResource(dispense));
  }

  async emar(hospitalId: string, encounterId: string) {
    if (!hospitalId || !encounterId)
      throw new BadRequestException('Hospital and encounter are required');
    const medplum = this.medplumService.getClient();
    let encounter: Encounter;
    try {
      encounter = await medplum.readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Encounter not found');
    }
    if (encounter.serviceProvider?.reference !== `Organization/${hospitalId}`)
      throw new NotFoundException('Encounter not found');
    const [requests, administrations] = await Promise.all([
      medplum.searchResources('MedicationRequest', {
        encounter: `Encounter/${encounterId}`,
        _count: '500',
      }),
      medplum.searchResources('MedicationAdministration', {
        context: `Encounter/${encounterId}`,
        _count: '1000',
      }),
    ]);
    const orders = requests
      .filter((item) => this.requestHospitalId(item) === hospitalId)
      .map((item) => ({
        ...this.mapRequest(item),
        pharmacyVerification: this.verification(item),
      }));
    const administrationsMapped = administrations
      .filter((item) =>
        item.extension?.some(
          (ext) =>
            ext.url === HOSPITAL &&
            ext.valueReference?.reference === `Organization/${hospitalId}`,
        ),
      )
      .map((item) => this.mapAdministration(item));
    return {
      hospitalId,
      encounterId,
      orders,
      administrations: administrationsMapped,
    };
  }

  async administer(dto: AdministerMedicationDto) {
    for (const field of [
      'hospitalId',
      'medicationRequestId',
      'patientId',
      'encounterId',
      'status',
      'nurseName',
    ] as const)
      if (!String(dto[field] ?? '').trim())
        throw new BadRequestException(`${field} is required`);
    if (!['given', 'held', 'refused', 'missed'].includes(dto.status))
      throw new BadRequestException('Invalid administration outcome');
    if (dto.status !== 'given' && !dto.reason?.trim())
      throw new BadRequestException(
        'Reason is required when medication is not given',
      );
    if (
      dto.status === 'given' &&
      (!dto.patientBarcode?.trim() || !dto.medicationBarcode?.trim())
    )
      throw new BadRequestException(
        'Patient and medication barcode scans are required before administration',
      );
    const medplum = this.medplumService.getClient();
    const request = await this.readRequest(
      dto.medicationRequestId,
      dto.hospitalId,
    );
    if (
      request.subject?.reference !== `Patient/${dto.patientId}` ||
      request.encounter?.reference !== `Encounter/${dto.encounterId}`
    )
      throw new NotFoundException('Medication order not found');
    if (this.verification(request)?.decision !== 'approved')
      throw new ConflictException(
        'Pharmacist verification is required before administration',
      );
    const dispenses = await medplum.searchResources('MedicationDispense', {
      prescription: `MedicationRequest/${dto.medicationRequestId}`,
      _count: '100',
    });
    const supplied = dispenses.filter(
      (item) =>
        this.dispenseHospitalId(item) === dto.hospitalId &&
        item.status === 'completed',
    );
    if (supplied.length === 0)
      throw new ConflictException(
        'Medication must be supplied before administration',
      );
    if (dto.status === 'given') {
      const patient: Patient = await medplum.readResource(
        'Patient',
        dto.patientId,
      );
      if (
        !patient.identifier?.some(
          (identifier) => identifier.value === dto.patientBarcode?.trim(),
        )
      )
        throw new ConflictException({
          message: 'Patient barcode does not match',
          code: 'BCMA_PATIENT_MISMATCH',
        });
      const allocatedIds = supplied.flatMap((item) =>
        this.allocations(item).map((allocation) => allocation.medicationId),
      );
      const batches: Medication[] = await Promise.all(
        allocatedIds.map((id) => medplum.readResource('Medication', id)),
      );
      if (
        !batches.some((item) =>
          item.identifier?.some(
            (identifier) => identifier.value === dto.medicationBarcode?.trim(),
          ),
        )
      )
        throw new ConflictException({
          message: 'Medication barcode does not match supplied medication',
          code: 'BCMA_MEDICATION_MISMATCH',
        });
    }
    const occurred = dto.administeredAt ?? new Date().toISOString();
    const resource: MedicationAdministration = {
      resourceType: 'MedicationAdministration',
      status:
        dto.status === 'given'
          ? 'completed'
          : dto.status === 'held'
            ? 'on-hold'
            : 'not-done',
      statusReason: dto.reason ? [{ text: dto.reason.trim() }] : undefined,
      medicationCodeableConcept: request.medicationCodeableConcept,
      subject: { reference: `Patient/${dto.patientId}` },
      context: { reference: `Encounter/${dto.encounterId}` },
      effectiveDateTime: occurred,
      request: { reference: `MedicationRequest/${dto.medicationRequestId}` },
      performer: [
        {
          actor: dto.nurseId
            ? {
                reference: `Practitioner/${dto.nurseId}`,
                display: dto.nurseName.trim(),
              }
            : { display: dto.nurseName.trim() },
        },
      ],
      dosage:
        dto.status === 'given'
          ? {
              route: dto.route ? { text: dto.route.trim() } : undefined,
              dose:
                dto.dose !== undefined
                  ? { value: dto.dose, unit: dto.doseUnit }
                  : undefined,
            }
          : undefined,
      note: dto.notes?.trim() ? [{ text: dto.notes.trim() }] : undefined,
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${dto.hospitalId}` },
        },
        { url: `${BASE}emar-outcome`, valueCode: dto.status },
        ...(dto.scheduledAt
          ? [
              {
                url: `${BASE}scheduled-administration-time`,
                valueDateTime: dto.scheduledAt,
              },
            ]
          : []),
        ...(dto.patientBarcode
          ? [
              {
                url: `${BASE}bcma-patient-barcode`,
                valueString: dto.patientBarcode.trim(),
              },
            ]
          : []),
        ...(dto.medicationBarcode
          ? [
              {
                url: `${BASE}bcma-medication-barcode`,
                valueString: dto.medicationBarcode.trim(),
              },
            ]
          : []),
      ],
    };
    return this.mapAdministration(
      await medplum.createResource<MedicationAdministration>(resource),
    );
  }
  private async readRequest(id: string, hospitalId: string) {
    let request: MedicationRequest;
    try {
      request = await this.medplumService
        .getClient()
        .readResource('MedicationRequest', id);
    } catch {
      throw new NotFoundException('Prescription not found');
    }
    if (this.requestHospitalId(request) !== hospitalId)
      throw new NotFoundException('Prescription not found');
    return request;
  }
  private verification(item: MedicationRequest) {
    try {
      return JSON.parse(
        item.extension?.find((ext) => ext.url === VERIFICATION)?.valueString ??
          'null',
      ) as {
        decision?: string;
        allergyChecked?: boolean;
        interactionChecked?: boolean;
        doseChecked?: boolean;
        stockChecked?: boolean;
        pharmacistName?: string;
        verifiedAt?: string;
      } | null;
    } catch {
      return null;
    }
  }
  private mapAdministration(item: MedicationAdministration) {
    return {
      id: item.id,
      status: item.extension?.find((ext) => ext.url === `${BASE}emar-outcome`)
        ?.valueCode,
      fhirStatus: item.status,
      patientId: item.subject.reference?.replace('Patient/', ''),
      encounterId: item.context?.reference?.replace('Encounter/', ''),
      medicationRequestId: item.request?.reference?.replace(
        'MedicationRequest/',
        '',
      ),
      medicationName: item.medicationCodeableConcept?.text,
      nurseId: item.performer?.[0]?.actor.reference?.replace(
        'Practitioner/',
        '',
      ),
      nurseName: item.performer?.[0]?.actor.display,
      scheduledAt: item.extension?.find(
        (ext) => ext.url === `${BASE}scheduled-administration-time`,
      )?.valueDateTime,
      administeredAt: item.effectiveDateTime,
      reason: item.statusReason?.[0]?.text,
      dose: item.dosage?.dose?.value,
      doseUnit: item.dosage?.dose?.unit,
      route: item.dosage?.route?.text,
      bcmaVerified: Boolean(
        item.extension?.find(
          (ext) => ext.url === `${BASE}bcma-patient-barcode`,
        ) &&
        item.extension?.find(
          (ext) => ext.url === `${BASE}bcma-medication-barcode`,
        ),
      ),
    };
  }
  private hospitalId(item: Medication) {
    return item.extension
      ?.find((ext) => ext.url === HOSPITAL)
      ?.valueReference?.reference?.replace('Organization/', '');
  }
  private requestHospitalId(item: MedicationRequest) {
    return item.extension
      ?.find((ext) => ext.url === `${BASE}medication-hospital`)
      ?.valueReference?.reference?.replace('Organization/', '');
  }
  private dispenseHospitalId(item: MedicationDispense) {
    return item.extension
      ?.find((ext) => ext.url === HOSPITAL)
      ?.valueReference?.reference?.replace('Organization/', '');
  }
  private integer(item: { extension?: any[] }, url: string) {
    return Number(
      item.extension?.find((ext) => ext.url === url)?.valueInteger ?? 0,
    );
  }
  private setInteger(item: { extension?: any[] }, url: string, value: number) {
    const ext = item.extension?.find((entry) => entry.url === url);
    if (ext) ext.valueInteger = value;
    else
      item.extension = [
        ...(item.extension ?? []),
        { url, valueInteger: value },
      ];
  }
  private stock(item: Medication) {
    return this.integer(item, STOCK);
  }
  private returned(item: MedicationDispense) {
    return this.integer(item, RETURNED);
  }
  private allocations(item: MedicationDispense) {
    try {
      return JSON.parse(
        item.extension?.find((ext) => ext.url === ALLOCATIONS)?.valueString ??
          '[]',
      ) as Array<{
        medicationId: string;
        lotNumber?: string;
        quantity: number;
      }>;
    } catch {
      return [];
    }
  }
  private mapStock(item: Medication) {
    return {
      id: item.id,
      medicationCode: item.code?.coding?.[0]?.code,
      medicationName: item.code?.text ?? item.code?.coding?.[0]?.display,
      form: item.form?.text,
      strength: item.extension?.find(
        (ext) => ext.url === `${BASE}medication-strength`,
      )?.valueString,
      unit: item.extension?.find((ext) => ext.url === UNIT)?.valueString,
      lotNumber: item.batch?.lotNumber,
      expirationDate: item.batch?.expirationDate,
      quantity: this.stock(item),
      reorderLevel: this.integer(item, REORDER),
    };
  }
  private mapRequest(item: MedicationRequest) {
    return {
      id: item.id,
      patientId: item.subject?.reference?.replace('Patient/', ''),
      encounterId: item.encounter?.reference?.replace('Encounter/', ''),
      medicationCode: item.medicationCodeableConcept?.coding?.[0]?.code,
      medicationName: item.medicationCodeableConcept?.text,
      quantity: item.dispenseRequest?.quantity?.value,
      quantityUnit: item.dispenseRequest?.quantity?.unit,
      priority: item.priority,
      authoredOn: item.authoredOn,
      instructions: item.dosageInstruction?.[0]?.text,
      pharmacyVerification: this.verification(item),
    };
  }
  private mapDispense(item: MedicationDispense) {
    return {
      id: item.id,
      identifier: item.identifier?.[0]?.value,
      status: item.status,
      patientId: item.subject?.reference?.replace('Patient/', ''),
      encounterId: item.context?.reference?.replace('Encounter/', ''),
      medicationRequestId:
        item.authorizingPrescription?.[0]?.reference?.replace(
          'MedicationRequest/',
          '',
        ),
      medicationName: item.medicationCodeableConcept?.text,
      quantity: item.quantity?.value,
      unit: item.quantity?.unit,
      returnedQuantity: this.returned(item),
      pharmacistName: item.performer?.[0]?.actor?.display,
      whenHandedOver: item.whenHandedOver,
      notes: item.note?.[0]?.text,
      counseling: (() => {
        try {
          return JSON.parse(
            item.extension?.find((ext) => ext.url === COUNSELING)
              ?.valueString ?? 'null',
          );
        } catch {
          return null;
        }
      })(),
      wardName: item.extension?.find((ext) => ext.url === WARD)?.valueReference
        ?.display,
    };
  }
}
