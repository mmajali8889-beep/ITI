# Stage 19 — Billing acceptance

## Automatic charge flow

The encounter capture engine discovers consultation/encounter activity, laboratory and radiology `ServiceRequest` records, `MedicationDispense`, room/bed days, completed `Procedure`/surgery and procedure consumables. Each charge retains its source reference and the engine refuses to capture the same event twice.

Pricing is resolved only from an active hospital-scoped FHIR `ChargeItemDefinition`. Missing tariffs are reported as skipped instead of silently assigning an unsafe price.

## Revenue cycle

- `ChargeItem` → patient account → `Invoice`.
- Cash/card/bank payment → `PaymentReconciliation` + `PaymentNotice` + receipt number.
- Insurance invoice → `Claim` → payer `ClaimResponse` → accepted/partial/rejected outcome → insurance payment reconciliation.
- Patient account aggregates captured, invoiced, paid and outstanding amounts with charges, invoices, claims and receipts.

## Acceptance checks

1. Configure tariffs for every chargeable category.
2. Capture an encounter twice and verify the second run reports every existing source as already captured.
3. Create an invoice and verify included charges become billed.
4. Record cash payment and verify receipt and invoice balance.
5. Submit an insurance claim, record payer acceptance/rejection and verify approved amounts reconcile against the invoice.
6. Verify all reads and writes remain hospital scoped.

Automated tests cover tariff-based capture, invoices, payments, claims, adjudication and isolation. Production rollout still requires the hospital price list, tax rules, discounts, payer-specific claim formats, remittance imports and accounting/ERP integration.
