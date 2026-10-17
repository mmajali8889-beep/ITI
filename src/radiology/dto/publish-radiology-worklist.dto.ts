export class PublishRadiologyWorklistDto {
  /** ISO-8601 date/time. If omitted, current date/time is used. */
  scheduledAt?: string;

  /** Preferred configured FHIR Device station ID. */
  stationId?: string;

  /** DICOM AE Title. Used as fallback when stationId is not supplied. */
  stationAet?: string;

  /** Human-readable station name. */
  stationName?: string;

  /** Optional performing physician name written to the MWL item. */
  performingPhysicianName?: string;
}
