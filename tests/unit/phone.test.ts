import { describe, expect, it } from 'vitest';
import { isValidE164, maskPhone, normalizeWhatsAppAddress } from '../../src/server/lib/phone.js';

describe('phone helpers', () => {
  it('masks phone numbers for logs (PII)', () => {
    const masked = maskPhone('+12085550101');
    expect(masked).toBe('+1••••••0101');
    expect(masked).not.toContain('555');
  });

  it('handles short and missing values', () => {
    expect(maskPhone(null)).toBe('(no phone)');
    expect(maskPhone('+123')).toBe('••••');
  });

  it('strips the whatsapp: prefix', () => {
    expect(normalizeWhatsAppAddress('whatsapp:+12085550101')).toBe('+12085550101');
    expect(normalizeWhatsAppAddress('+12085550101')).toBe('+12085550101');
  });

  it('validates E.164 loosely', () => {
    expect(isValidE164('+12085550101')).toBe(true);
    expect(isValidE164('+5215512345678')).toBe(true);
    expect(isValidE164('2085550101')).toBe(false);
    expect(isValidE164('+1 208 555 0101')).toBe(false);
  });
});
