export interface Hospital {
  id: string;
  name: string;
  code: string;
  /** Whether users may sign in to this hospital in the current rollout (server-defined). */
  signInEnabled?: boolean;
}