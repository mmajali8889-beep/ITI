export class CreatePortalAccessDto {
  hospitalId?: string;
  /** A plain username (signs in as <username>@unitech.local) or an email. */
  username!: string;
  /** Optional; a one-time password is generated when omitted. */
  password?: string;
}
export class ResetPortalAccessDto {
  hospitalId?: string;
  /** Which login (ProjectMembership id); defaults to the active or latest one. */
  loginId?: string;
  /** Optional; a one-time password is generated when omitted. */
  password?: string;
}
