// The hospital's currency. Set VITE_HOSPITAL_CURRENCY at build time; it must
// match the API's HOSPITAL_CURRENCY. Jordanian dinar by default.
export const HOSPITAL_CURRENCY: string =
  (import.meta.env.VITE_HOSPITAL_CURRENCY as string | undefined)?.trim().toUpperCase() || 'JOD';
