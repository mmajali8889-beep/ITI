/**
 * The hospital's currency (ISO 4217), used whenever a price, charge, invoice or
 * payment does not name one. Set HOSPITAL_CURRENCY; Jordanian dinar by default.
 * Records keep the currency they were created with.
 */
export const SUPPORTED_CURRENCIES = ['JOD', 'SAR', 'USD', 'EUR'] as const;
export type HospitalCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function hospitalCurrency(
  env: NodeJS.ProcessEnv = process.env,
): HospitalCurrency {
  const configured = env.HOSPITAL_CURRENCY?.trim().toUpperCase();
  return SUPPORTED_CURRENCIES.includes(configured as HospitalCurrency)
    ? (configured as HospitalCurrency)
    : 'JOD';
}
