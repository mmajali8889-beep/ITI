# Stage 8 — Radiology / RIS / PACS Acceptance Record

## Implemented workflow

1. Physician creates a hospital-scoped FHIR `ServiceRequest` with modality, clinical indication/question, priority and accession number.
2. Radiology scheduling publishes the order to the modality worklist with scheduled time, station/AE title and performing physician.
3. Arrival and exam start are represented in the RIS workflow and worklist.
4. CT, MRI, X-Ray, US and the configured additional modalities consume the worklist.
5. PACS/Orthanc synchronization creates or updates a FHIR `ImagingStudy` and advances the order to `acquired`.
6. The radiologist directory, assignment and filtered worklist support reporting ownership.
7. Creating a report advances the workflow through `reporting` to `preliminary`.
8. Finalization requires findings, impression, verifier identity and explicit sign-off confirmation; the report becomes final and the order completes.
9. Patient chart radiology cards expose both `View Report` and `View Images`; the image action opens the configured PACS/OHIF viewer by StudyInstanceUID.

## Status model

`ordered → scheduled → arrived → exam-started → acquired → reporting → preliminary → final`

The legacy `images-available` value remains readable for backward compatibility, while new PACS synchronization writes `acquired`.

## Trust and safety controls

- Patient, Encounter and hospital context are validated.
- Non-emergency orders require financial clearance.
- Workflow regression is rejected/idempotently ignored.
- PACS matching uses accession number and StudyInstanceUID.
- Final reports are immutable except through the amendment workflow.

External DICOM conformance, modality-vendor certification, production PACS connectivity and supervised radiology UAT remain deployment-environment acceptance activities.
