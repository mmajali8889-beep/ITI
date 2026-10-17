import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Basic,
  Extension,
  SupplyDelivery,
  SupplyRequest,
} from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { MedplumService } from '../medplum/medplum.service';
import { isBlank } from '../common/is-blank';
import {
  ApprovePurchaseRequestDto,
  CreateInventoryItemDto,
  CreatePurchaseOrderDto,
  CreatePurchaseRequestDto,
  ReceiveGoodsDto,
  StockMovementDto,
} from './dto/inventory.dto';
const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition',
  HOSPITAL = `${BASE}/inventory-hospital`,
  SKU = `${BASE}/inventory-sku`,
  CATEGORY = `${BASE}/inventory-category`,
  UNIT = `${BASE}/inventory-unit`,
  REORDER = `${BASE}/inventory-reorder-point`,
  STOCK = `${BASE}/inventory-stock`,
  SUPPLIER = `${BASE}/preferred-supplier`,
  STAGE = `${BASE}/supply-stage`,
  ITEM = `${BASE}/inventory-item`,
  DEPARTMENT = `${BASE}/request-department`,
  APPROVAL = `${BASE}/supply-approval`,
  SOURCE_REQUEST = `${BASE}/source-purchase-request`,
  UNIT_COST = `${BASE}/purchase-unit-cost`,
  RECEIVED = `${BASE}/purchase-received-quantity`,
  LOT = `${BASE}/inventory-lot`,
  EXPIRY = `${BASE}/inventory-expiry`,
  SOURCE = `${BASE}/inventory-source-location`,
  REASON = `${BASE}/inventory-movement-reason`;
type StockLocation = {
  locationId: string;
  locationName: string;
  quantity: number;
  lots: Array<{ lotNumber: string; expiryDate?: string; quantity: number }>;
};
@Injectable()
export class InventoryService {
  constructor(private readonly medplumService: MedplumService) {}
  async createItem(d: CreateInventoryItemDto) {
    this.required(d, ['hospitalId', 'sku', 'name', 'category', 'unit']);
    if (!Number.isFinite(d.reorderPoint) || d.reorderPoint < 0)
      throw new BadRequestException('Valid reorder point is required');
    if (
      !['pharmacy', 'laboratory', 'clinical-supply', 'general'].includes(
        d.category,
      )
    )
      throw new BadRequestException('Invalid inventory category');
    const existing = await this.medplumService
      .getClient()
      .searchResources('Basic', { _count: '1000' });
    if (
      existing.some(
        (i) =>
          this.hospital(i) === d.hospitalId &&
          this.ext(i, SKU) === d.sku.trim(),
      )
    )
      throw new ConflictException('Inventory SKU already exists');
    const extensions: Extension[] = [
      {
        url: HOSPITAL,
        valueReference: { reference: `Organization/${d.hospitalId}` },
      },
      { url: SKU, valueString: d.sku.trim() },
      { url: CATEGORY, valueCode: d.category },
      { url: UNIT, valueString: d.unit.trim() },
      { url: REORDER, valueDecimal: Number(d.reorderPoint) },
      { url: STOCK, valueString: '[]' },
    ];
    if (d.preferredSupplierId)
      extensions.push({
        url: SUPPLIER,
        valueReference: {
          reference: `Organization/${d.preferredSupplierId}`,
          display: d.preferredSupplierName,
        },
      });
    const item: Basic = {
      resourceType: 'Basic',
      code: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/basic-resource-kind',
            code: 'inventory-item',
          },
        ],
        text: d.name.trim(),
      },
      created: new Date().toISOString(),
      author: { reference: `Organization/${d.hospitalId}` },
      identifier: [
        {
          system: `https://hospital-ehr.local/inventory/${d.hospitalId}`,
          value: d.sku.trim(),
        },
      ],
      extension: extensions,
    };
    return this.mapItem(
      await this.medplumService.getClient().createResource(item),
    );
  }
  async items(hospitalId: string) {
    this.requireHospital(hospitalId);
    const all = await this.medplumService
      .getClient()
      .searchResources('Basic', { _count: '1000' });
    return {
      hospitalId,
      items: all
        .filter(
          (i) =>
            i.code?.coding?.some((c) => c.code === 'inventory-item') &&
            this.hospital(i) === hospitalId,
        )
        .map((i) => this.mapItem(i)),
    };
  }
  async createRequest(d: CreatePurchaseRequestDto) {
    this.required(d, [
      'hospitalId',
      'itemId',
      'requesterId',
      'requesterName',
      'departmentId',
      'departmentName',
      'warehouseId',
      'warehouseName',
      'justification',
    ]);
    this.quantity(d.quantity);
    const item = await this.item(d.itemId, d.hospitalId),
      now = new Date().toISOString();
    const r: SupplyRequest = {
      resourceType: 'SupplyRequest',
      identifier: [
        {
          system: `https://hospital-ehr.local/purchase-request/${d.hospitalId}`,
          value: `PR-${randomUUID().slice(0, 8).toUpperCase()}`,
        },
      ],
      status: 'draft',
      category: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/supplyrequest-kind',
            code: 'central',
          },
        ],
        text: 'Purchase request',
      },
      priority: 'routine',
      itemCodeableConcept: {
        text: item.code.text,
        coding: [
          {
            system: `https://hospital-ehr.local/inventory/${d.hospitalId}`,
            code: this.ext(item, SKU),
          },
        ],
      },
      quantity: { value: d.quantity, unit: this.ext(item, UNIT) },
      authoredOn: now,
      requester: {
        reference: `Practitioner/${d.requesterId}`,
        display: d.requesterName.trim(),
      },
      reasonCode: [{ text: d.justification.trim() }],
      deliverTo: {
        reference: `Location/${d.warehouseId}`,
        display: d.warehouseName.trim(),
      },
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${d.hospitalId}` },
        },
        { url: STAGE, valueCode: 'purchase-request' },
        {
          url: ITEM,
          valueReference: {
            reference: `Basic/${d.itemId}`,
            display: item.code.text,
          },
        },
        {
          url: DEPARTMENT,
          valueReference: {
            reference: `Organization/${d.departmentId}`,
            display: d.departmentName.trim(),
          },
        },
      ],
    };
    return this.mapRequest(
      await this.medplumService.getClient().createResource(r),
    );
  }
  async requests(hospitalId: string) {
    this.requireHospital(hospitalId);
    const all = await this.medplumService
      .getClient()
      .searchResources('SupplyRequest', { _count: '1000' });
    return {
      hospitalId,
      items: all
        .filter((r) => this.hospital(r) === hospitalId)
        .map((r) => this.mapRequest(r))
        .sort((a, b) => (b.authoredOn ?? '').localeCompare(a.authoredOn ?? '')),
    };
  }
  async approve(id: string, d: ApprovePurchaseRequestDto) {
    this.required(d, ['hospitalId', 'approverId', 'approverName']);
    if (!d.confirmation)
      throw new BadRequestException('Approval confirmation is required');
    const r = await this.request(id, d.hospitalId, 'purchase-request');
    if (r.status !== 'draft')
      throw new ConflictException(
        'Only a draft purchase request can be approved',
      );
    r.status = 'active';
    r.extension = [
      ...(r.extension ?? []).filter((e) => e.url !== APPROVAL),
      {
        url: APPROVAL,
        valueString: JSON.stringify({
          approverId: d.approverId,
          approverName: d.approverName.trim(),
          note: d.note?.trim(),
          approvedAt: new Date().toISOString(),
        }),
      },
    ];
    return this.mapRequest(
      await this.medplumService.getClient().updateResource(r),
    );
  }
  async purchaseOrder(id: string, d: CreatePurchaseOrderDto) {
    this.required(d, [
      'hospitalId',
      'supplierId',
      'supplierName',
      'buyerId',
      'buyerName',
    ]);
    if (!Number.isFinite(d.unitCost) || d.unitCost < 0)
      throw new BadRequestException('Valid unit cost is required');
    const pr = await this.request(id, d.hospitalId, 'purchase-request');
    if (
      pr.status !== 'active' ||
      !pr.extension?.some((e) => e.url === APPROVAL)
    )
      throw new ConflictException('Purchase request must be approved');
    const po: SupplyRequest = {
      ...pr,
      id: undefined,
      meta: undefined,
      status: 'active',
      identifier: [
        {
          system: `https://hospital-ehr.local/purchase-order/${d.hospitalId}`,
          value: `PO-${randomUUID().slice(0, 8).toUpperCase()}`,
        },
      ],
      category: { text: 'Purchase order' },
      supplier: [
        {
          reference: `Organization/${d.supplierId}`,
          display: d.supplierName.trim(),
        },
      ],
      requester: {
        reference: `Practitioner/${d.buyerId}`,
        display: d.buyerName.trim(),
      },
      authoredOn: new Date().toISOString(),
      extension: [
        ...(pr.extension ?? []).filter(
          (e) => ![STAGE, SOURCE_REQUEST, UNIT_COST, RECEIVED].includes(e.url),
        ),
        { url: STAGE, valueCode: 'purchase-order' },
        {
          url: SOURCE_REQUEST,
          valueReference: { reference: `SupplyRequest/${id}` },
        },
        {
          url: UNIT_COST,
          valueMoney: {
            value: Number(d.unitCost),
            currency: d.currency || 'SAR',
          },
        },
        { url: RECEIVED, valueDecimal: 0 },
      ],
    };
    const made = await this.medplumService.getClient().createResource(po);
    pr.status = 'completed';
    await this.medplumService.getClient().updateResource(pr);
    return this.mapRequest(made);
  }
  async receive(id: string, d: ReceiveGoodsDto) {
    this.required(d, [
      'hospitalId',
      'receiverId',
      'receiverName',
      'warehouseId',
      'warehouseName',
      'lotNumber',
    ]);
    this.quantity(d.quantity);
    if (d.expiryDate && Number.isNaN(Date.parse(d.expiryDate)))
      throw new BadRequestException('Invalid expiry date');
    const po = await this.request(id, d.hospitalId, 'purchase-order');
    if (po.status !== 'active')
      throw new ConflictException('Purchase order is not open');
    const received = this.numberExt(po, RECEIVED),
      ordered = po.quantity.value ?? 0;
    if (received + d.quantity > ordered)
      throw new ConflictException(
        'Received quantity exceeds the purchase order',
      );
    const itemId = this.ref(po, ITEM)?.replace('Basic/', '');
    if (!itemId) throw new ConflictException('Purchase order item is missing');
    const item = await this.item(itemId, d.hospitalId);
    this.addStock(
      item,
      d.warehouseId,
      d.warehouseName,
      d.quantity,
      d.lotNumber,
      d.expiryDate,
    );
    await this.medplumService.getClient().updateResource(item);
    const supplier = po.supplier?.[0]?.reference?.startsWith('Organization/')
      ? { reference: po.supplier[0].reference, display: po.supplier[0].display }
      : undefined;
    const delivery: SupplyDelivery = {
      resourceType: 'SupplyDelivery',
      identifier: [{ value: `GRN-${randomUUID().slice(0, 8).toUpperCase()}` }],
      basedOn: [{ reference: `SupplyRequest/${id}` }],
      status: 'completed',
      type: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/stock-movement',
            code: 'goods-received',
          },
        ],
      },
      suppliedItem: {
        quantity: { value: d.quantity, unit: this.ext(item, UNIT) },
        itemCodeableConcept: {
          text: item.code.text,
          coding: [{ code: this.ext(item, SKU) }],
        },
      },
      occurrenceDateTime: new Date().toISOString(),
      supplier,
      destination: {
        reference: `Location/${d.warehouseId}`,
        display: d.warehouseName.trim(),
      },
      receiver: [
        {
          reference: `Practitioner/${d.receiverId}`,
          display: d.receiverName.trim(),
        },
      ],
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${d.hospitalId}` },
        },
        { url: ITEM, valueReference: { reference: `Basic/${itemId}` } },
        { url: LOT, valueString: d.lotNumber.trim() },
        ...(d.expiryDate
          ? [{ url: EXPIRY, valueDate: d.expiryDate.slice(0, 10) }]
          : []),
        ...(d.invoiceReference
          ? [{ url: REASON, valueString: d.invoiceReference.trim() }]
          : []),
      ],
    };
    const made = await this.medplumService.getClient().createResource(delivery);
    po.extension = [
      ...(po.extension ?? []).filter((e) => e.url !== RECEIVED),
      { url: RECEIVED, valueDecimal: received + d.quantity },
    ];
    if (received + d.quantity === ordered) po.status = 'completed';
    await this.medplumService.getClient().updateResource(po);
    return {
      delivery: this.mapDelivery(made),
      purchaseOrder: this.mapRequest(po),
      item: this.mapItem(item),
    };
  }
  async move(d: StockMovementDto) {
    this.required(d, [
      'hospitalId',
      'itemId',
      'sourceLocationId',
      'sourceLocationName',
      'actorId',
      'actorName',
      'reason',
      'type',
    ]);
    this.quantity(d.quantity);
    if (!['transfer', 'consumption', 'wastage'].includes(d.type))
      throw new BadRequestException('Invalid stock movement');
    if (d.type === 'transfer' && !d.destinationLocationId)
      throw new BadRequestException('Transfer destination is required');
    const item = await this.item(d.itemId, d.hospitalId),
      stock = this.stock(item),
      source = stock.find((x) => x.locationId === d.sourceLocationId);
    if (!source || source.quantity < d.quantity)
      throw new ConflictException('Insufficient stock at source location');
    this.removeStock(source, d.quantity, d.lotNumber);
    if (d.type === 'transfer')
      this.addStockValue(
        stock,
        d.destinationLocationId!,
        d.destinationLocationName || d.destinationLocationId!,
        d.quantity,
        d.lotNumber || 'UNSPECIFIED',
        d.expiryDate,
      );
    this.setStock(item, stock);
    await this.medplumService.getClient().updateResource(item);
    const delivery: SupplyDelivery = {
      resourceType: 'SupplyDelivery',
      identifier: [{ value: `MOV-${randomUUID().slice(0, 8).toUpperCase()}` }],
      status: 'completed',
      type: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/stock-movement',
            code: d.type,
          },
        ],
      },
      suppliedItem: {
        quantity: { value: d.quantity, unit: this.ext(item, UNIT) },
        itemCodeableConcept: {
          text: item.code.text,
          coding: [{ code: this.ext(item, SKU) }],
        },
      },
      occurrenceDateTime: new Date().toISOString(),
      destination: d.destinationLocationId
        ? {
            reference: `Location/${d.destinationLocationId}`,
            display: d.destinationLocationName,
          }
        : undefined,
      receiver: [
        { reference: `Practitioner/${d.actorId}`, display: d.actorName.trim() },
      ],
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${d.hospitalId}` },
        },
        { url: ITEM, valueReference: { reference: `Basic/${d.itemId}` } },
        {
          url: SOURCE,
          valueReference: {
            reference: `Location/${d.sourceLocationId}`,
            display: d.sourceLocationName.trim(),
          },
        },
        { url: REASON, valueString: d.reason.trim() },
        ...(d.lotNumber ? [{ url: LOT, valueString: d.lotNumber.trim() }] : []),
      ],
    };
    return {
      movement: this.mapDelivery(
        await this.medplumService.getClient().createResource(delivery),
      ),
      item: this.mapItem(item),
    };
  }
  async dashboard(hospitalId: string) {
    const [itemResult, requestResult] = await Promise.all([
        this.items(hospitalId),
        this.requests(hospitalId),
      ]),
      deliveries = await this.medplumService
        .getClient()
        .searchResources('SupplyDelivery', { _count: '1000' }),
      items = itemResult.items,
      now = Date.now(),
      soon = now + 90 * 86400000;
    return {
      hospitalId,
      summary: {
        items: items.length,
        totalStock: items.reduce((n, i) => n + i.totalStock, 0),
        lowStock: items.filter((i) => i.totalStock <= i.reorderPoint).length,
        expiringLots: items.reduce(
          (n, i) =>
            n +
            i.locations
              .flatMap((l: StockLocation) => l.lots)
              .filter(
                (lot: { expiryDate?: string }) =>
                  lot.expiryDate && Date.parse(lot.expiryDate) <= soon,
              ).length,
          0,
        ),
        openRequests: requestResult.items.filter(
          (r) => r.status !== 'completed' && r.stage === 'purchase-request',
        ).length,
        openOrders: requestResult.items.filter(
          (r) => r.status === 'active' && r.stage === 'purchase-order',
        ).length,
      },
      alerts: items
        .filter((i) => i.totalStock <= i.reorderPoint)
        .map((i) => ({
          type: i.totalStock === 0 ? 'out-of-stock' : 'reorder',
          itemId: i.id,
          sku: i.sku,
          name: i.name,
          current: i.totalStock,
          reorderPoint: i.reorderPoint,
        })),
      items,
      requests: requestResult.items,
      movements: deliveries
        .filter((d) => this.hospital(d) === hospitalId)
        .map((d) => this.mapDelivery(d))
        .slice(-100)
        .reverse(),
    };
  }
  private async item(id: string, hospitalId: string) {
    let i: Basic;
    try {
      i = await this.medplumService.getClient().readResource('Basic', id);
    } catch {
      throw new NotFoundException('Inventory item not found');
    }
    if (
      this.hospital(i) !== hospitalId ||
      !i.code?.coding?.some((c) => c.code === 'inventory-item')
    )
      throw new NotFoundException('Inventory item not found');
    return i;
  }
  private async request(id: string, hospitalId: string, stage: string) {
    let r: SupplyRequest;
    try {
      r = await this.medplumService
        .getClient()
        .readResource('SupplyRequest', id);
    } catch {
      throw new NotFoundException('Supply request not found');
    }
    if (this.hospital(r) !== hospitalId || this.ext(r, STAGE) !== stage)
      throw new NotFoundException('Supply request not found');
    return r;
  }
  private stock(i: Basic): StockLocation[] {
    try {
      return JSON.parse(this.ext(i, STOCK) ?? '[]') as StockLocation[];
    } catch {
      return [];
    }
  }
  private setStock(i: Basic, s: StockLocation[]) {
    i.extension = [
      ...(i.extension ?? []).filter((e) => e.url !== STOCK),
      { url: STOCK, valueString: JSON.stringify(s) },
    ];
  }
  private addStock(
    i: Basic,
    l: string,
    n: string,
    q: number,
    lot: string,
    expiry?: string,
  ) {
    const s = this.stock(i);
    this.addStockValue(s, l, n, q, lot, expiry);
    this.setStock(i, s);
  }
  private addStockValue(
    s: StockLocation[],
    l: string,
    n: string,
    q: number,
    lot: string,
    expiry?: string,
  ) {
    let x = s.find((v) => v.locationId === l);
    if (!x) {
      x = { locationId: l, locationName: n, quantity: 0, lots: [] };
      s.push(x);
    }
    x.quantity += q;
    const b = x.lots.find(
      (v) => v.lotNumber === lot && v.expiryDate === expiry,
    );
    if (b) b.quantity += q;
    else x.lots.push({ lotNumber: lot, expiryDate: expiry, quantity: q });
  }
  private removeStock(x: StockLocation, q: number, lot?: string) {
    let left = q;
    const lots = [...x.lots].sort((a, b) =>
      (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'),
    );
    for (const b of lots) {
      if (lot && b.lotNumber !== lot) continue;
      const take = Math.min(b.quantity, left);
      b.quantity -= take;
      left -= take;
      if (!left) break;
    }
    if (left)
      throw new ConflictException(
        lot ? 'Insufficient stock for selected lot' : 'Insufficient lot stock',
      );
    x.lots = x.lots.filter((b) => b.quantity > 0);
    x.quantity -= q;
  }
  private mapItem(i: Basic) {
    const locations = this.stock(i);
    return {
      id: i.id,
      sku: this.ext(i, SKU),
      name: i.code.text,
      category: this.ext(i, CATEGORY),
      unit: this.ext(i, UNIT),
      reorderPoint: this.numberExt(i, REORDER),
      totalStock: locations.reduce((n, x) => n + x.quantity, 0),
      locations,
      preferredSupplierId: this.ref(i, SUPPLIER)?.replace('Organization/', ''),
    };
  }
  private mapRequest(r: SupplyRequest) {
    return {
      id: r.id,
      number: r.identifier?.[0]?.value,
      status: r.status,
      stage: this.ext(r, STAGE),
      itemId: this.ref(r, ITEM)?.replace('Basic/', ''),
      itemName: r.itemCodeableConcept?.text,
      quantity: r.quantity.value,
      unit: r.quantity.unit,
      authoredOn: r.authoredOn,
      requester: r.requester?.display,
      supplierId: r.supplier?.[0]?.reference?.replace('Organization/', ''),
      supplierName: r.supplier?.[0]?.display,
      deliverTo: r.deliverTo?.display,
      received: this.numberExt(r, RECEIVED),
      unitCost: r.extension?.find((e) => e.url === UNIT_COST)?.valueMoney,
    };
  }
  private mapDelivery(d: SupplyDelivery) {
    return {
      id: d.id,
      number: d.identifier?.[0]?.value,
      type: d.type?.coding?.[0]?.code,
      status: d.status,
      itemId: this.ref(d, ITEM)?.replace('Basic/', ''),
      itemName: d.suppliedItem?.itemCodeableConcept?.text,
      quantity: d.suppliedItem?.quantity?.value,
      unit: d.suppliedItem?.quantity?.unit,
      occurredAt: d.occurrenceDateTime,
      source: this.ref(d, SOURCE)?.replace('Location/', ''),
      destination: d.destination?.reference?.replace('Location/', ''),
      lotNumber: this.ext(d, LOT),
      expiryDate: d.extension?.find((e) => e.url === EXPIRY)?.valueDate,
      reason: this.ext(d, REASON),
    };
  }
  private hospital(x: { extension?: Extension[] }) {
    return x.extension
      ?.find((e) => e.url === HOSPITAL)
      ?.valueReference?.reference?.replace('Organization/', '');
  }
  private ext(x: { extension?: Extension[] }, u: string) {
    const e = x.extension?.find((e) => e.url === u);
    return e?.valueString ?? e?.valueCode;
  }
  private ref(x: { extension?: Extension[] }, u: string) {
    return x.extension?.find((e) => e.url === u)?.valueReference?.reference;
  }
  private numberExt(x: { extension?: Extension[] }, u: string) {
    const e = x.extension?.find((e) => e.url === u);
    return e?.valueDecimal ?? 0;
  }
  private quantity(v: number) {
    if (!Number.isFinite(v) || v <= 0)
      throw new BadRequestException('Quantity must be greater than zero');
  }
  private requireHospital(h: string) {
    if (!h) throw new BadRequestException('Hospital ID is required');
  }
  private required(d: object, fields: string[]) {
    for (const f of fields)
      if (isBlank((d as Record<string, unknown>)[f]))
        throw new BadRequestException(`${f} is required`);
  }
}
