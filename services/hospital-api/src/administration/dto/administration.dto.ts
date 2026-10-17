export class CreateCatalogItemDto {
  hospitalId!: string;
  kind!: string;
  code!: string;
  name!: string;
  description?: string;
  parentId?: string;
  price?: number;
  currency?: string;
  specialty?: string;
}
export class CreateRoleDto {
  hospitalId!: string;
  code!: string;
  name!: string;
  permissions!: string[];
}
export class CreateUserProfileDto {
  hospitalId!: string;
  name!: string;
  identifier!: string;
  username!: string;
  password!: string;
  roles!: string[];
  permissions!: string[];
}
export class AssignRoleDto {
  hospitalId!: string;
  practitionerId!: string;
  roleCode!: string;
  roleName!: string;
  specialty?: string;
}
