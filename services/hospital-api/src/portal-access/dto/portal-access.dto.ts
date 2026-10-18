export class CreatePortalAccessDto {
  hospitalId?: string;
  /** A plain username (signs in as <username>@unitech.local) or an email. */
  username!: string;
  /** Optional; a one-time password is generated when omitted. */
  password?: string;
}
