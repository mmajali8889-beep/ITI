export class UpdateRadiologistDto {
  hospitalId!: string;
  givenName?: string;
  familyName?: string;
  displayName?: string;
  employeeId?: string;
  licenseNumber?: string;
  phone?: string;
  email?: string;
  active?: boolean;
}
