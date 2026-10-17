import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

import type { Hospital } from '../types/hospital';

interface HospitalContextType {
  hospital: Hospital | null;
  selectHospital: (hospital: Hospital) => void;
  clearHospital: () => void;
}

const HospitalContext =
  createContext<HospitalContextType | undefined>(undefined);

export function HospitalProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [hospital, setHospital] =
    useState<Hospital | null>(() => {
      const saved = localStorage.getItem('selectedHospital');

      if (!saved) {
        return null;
      }

      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    });

  const selectHospital = useCallback((hospital: Hospital) => {
    setHospital(hospital);

    localStorage.setItem(
      'selectedHospital',
      JSON.stringify(hospital)
    );
  }, []);

  const clearHospital = useCallback(() => {
    setHospital(null);

    localStorage.removeItem('selectedHospital');
  }, []);

  return (
    <HospitalContext.Provider
      value={{
        hospital,
        selectHospital,
        clearHospital,
      }}
    >
      {children}
    </HospitalContext.Provider>
  );
}

export function useHospital() {
  const context = useContext(HospitalContext);

  if (!context) {
    throw new Error(
      'useHospital must be used inside HospitalProvider'
    );
  }

  return context;
}
