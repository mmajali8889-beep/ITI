import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  getSession,
  logout,
  type AuthSession,
} from '../api/authApi';
import { useHospital } from './HospitalContext';
import { AuthContext, type AuthContextValue } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const { clearHospital } = useHospital();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getSession()
      .then((current) => {
        if (active) setSession(current);
      })
      .catch(() => {
        if (active) {
          setSession(null);
          clearHospital();
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clearHospital]);

  useEffect(() => {
    const handleAuthenticationRequired = () => {
      setSession(null);
      clearHospital();
    };
    window.addEventListener('unitech-auth-required', handleAuthenticationRequired);
    return () => {
      window.removeEventListener('unitech-auth-required', handleAuthenticationRequired);
    };
  }, [clearHospital]);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setSession(null);
      clearHospital();
    }
  }, [clearHospital]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    loading,
    setAuthenticatedSession: setSession,
    signOut,
  }), [loading, session, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
