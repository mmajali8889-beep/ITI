# Stage 23 — Inventory and Supply Chain

## Workflow

`Purchase Request → Approval → Purchase Order → Supplier → Goods Receipt → Warehouse → Department Transfer → Consumption/Wastage`

The implementation uses FHIR R4 `SupplyRequest` for purchase requests and purchase orders, `SupplyDelivery` for receipts and stock movements, and a hospital-scoped `Basic` inventory master because the R4 specification does not contain the R5 `InventoryItem` resource.

Controls include:

- Server-side RBAC for pharmacists, laboratory supervisors, supply-chain officers and administrators.
- Approval required before purchase-order creation.
- Open purchase order required before goods receipt.
- Partial receipts with prevention of over-receipt.
- Warehouse and departmental stock balances.
- Batch/lot and expiry tracking with FEFO consumption when no lot is selected.
- Prevention of negative stock and selected-lot over-issue.
- Transfers, consumption and wastage recorded as immutable `SupplyDelivery` movements.
- Reorder and 90-day expiry alerts.
- Hospital isolation and audited reads/writes.

For production accounting, inventory valuation, supplier invoice matching and concurrent high-volume posting should be finalized with transactional bundles, finance integration and an approved costing policy such as FIFO or weighted average.
