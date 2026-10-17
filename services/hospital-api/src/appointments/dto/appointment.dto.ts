export class CreateAppointmentDto {
  hospitalId!: string;
  patientId!: string;
  practitionerId?: string;
  practitionerName!: string;
  department!: string;
  serviceType!: string;
  reason!: string;
  start!: string;
  durationMinutes!: number;
  priority?: 'routine' | 'urgent';
  notes?: string;
  slotId?: string;
}

export class UpdateAppointmentStatusDto {
  hospitalId!: string;
  status!: 'booked' | 'confirmed' | 'arrived' | 'checked-in' | 'fulfilled' | 'cancelled' | 'noshow';
  cancellationReason?: string;
}

export class CreateScheduleDto { hospitalId!: string; practitionerId!: string; practitionerName!: string; specialty!: string; serviceType!: string; start!: string; end!: string; }
export class GenerateSlotsDto { hospitalId!: string; start!: string; end!: string; durationMinutes!: number; }
export class RescheduleAppointmentDto { hospitalId!: string; slotId!: string; reason!: string; }

export class CheckInAppointmentDto {
  hospitalId!: string;
}
