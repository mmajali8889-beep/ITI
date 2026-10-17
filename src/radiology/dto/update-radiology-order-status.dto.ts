export class UpdateRadiologyOrderStatusDto {
  status!: 'draft' | 'active' | 'on-hold' | 'revoked' | 'completed' | 'entered-in-error';
  hospitalId!: string;
}
