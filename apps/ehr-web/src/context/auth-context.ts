import { createContext } from 'react';
import type { AuthSession } from '../api/authApi';

export interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  setAuthenticatedSession: (session: AuthSession) => void;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
