export type InventoryCategory =
  'pharmacy' | 'laboratory' | 'clinical-supply' | 'general';
export class CreateInventoryItemDto {
  hospitalId!: string;
  sku!: string;
  name!: string;
  category!: InventoryCategory;
  unit!: string;
  reorderPoint!: number;
  preferredSupplierId?: string;
  preferredSupplierName?: string;
}
export class CreatePurchaseRequestDto {
  hospitalId!: string;
  itemId!: string;
  quantity!: number;
  requesterId!: string;
  requesterName!: string;
  departmentId!: string;
  departmentName!: string;
  warehouseId!: string;
  warehouseName!: string;
  justification!: string;
}
export class ApprovePurchaseRequestDto {
  hospitalId!: string;
  approverId!: string;
  approverName!: string;
  note?: string;
  confirmation!: boolean;
}
export class CreatePurchaseOrderDto {
  hospitalId!: string;
  supplierId!: string;
  supplierName!: string;
  unitCost!: number;
  currency?: 'SAR' | 'USD' | 'EUR';
  buyerId!: string;
  buyerName!: string;
}
export class ReceiveGoodsDto {
  hospitalId!: string;
  receiverId!: string;
  receiverName!: string;
  quantity!: number;
  warehouseId!: string;
  warehouseName!: string;
  lotNumber!: string;
  expiryDate?: string;
  invoiceReference?: string;
}
export class StockMovementDto {
  hospitalId!: string;
  itemId!: string;
  quantity!: number;
  sourceLocationId!: string;
  sourceLocationName!: string;
  destinationLocationId?: string;
  destinationLocationName?: string;
  actorId!: string;
  actorName!: string;
  reason!: string;
  lotNumber?: string;
  expiryDate?: string;
  type!: 'transfer' | 'consumption' | 'wastage';
}
