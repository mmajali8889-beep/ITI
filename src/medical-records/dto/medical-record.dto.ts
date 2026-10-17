export class AssessRecordDto { hospitalId!: string; ownerId?: string; ownerName?: string; }
export class CloseRecordDto { hospitalId!: string; practitionerId!: string; practitionerName!: string; confirmation!: boolean; }
export class AmendRecordDto { hospitalId!: string; practitionerId!: string; practitionerName!: string; reason!: string; note!: string; }
export class ResolveDeficiencyDto { hospitalId!: string; resolutionNote!: string; }
export class LockRecordDto { hospitalId!: string; himOfficerId!: string; himOfficerName!: string; confirmation!: boolean; }
export class ArchiveRecordDto { hospitalId!: string; archivistId!: string; archivistName!: string; retentionUntil?: string; confirmation!: boolean; }
