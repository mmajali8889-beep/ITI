import { hospitalCurrency } from './currency';

describe('hospitalCurrency', () => {
  it('is the Jordanian dinar unless configured', () => {
    expect(hospitalCurrency({})).toBe('JOD');
    expect(hospitalCurrency({ HOSPITAL_CURRENCY: 'sar' })).toBe('SAR');
    expect(hospitalCurrency({ HOSPITAL_CURRENCY: 'XYZ' })).toBe('JOD');
  });
});
