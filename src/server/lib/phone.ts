/** Strip the `whatsapp:` channel prefix Twilio puts on WhatsApp addresses. */
export function normalizeWhatsAppAddress(from: string): string {
  return from.replace(/^whatsapp:/i, '').trim();
}

/**
 * Mask a phone number for logs — worker phone numbers are PII.
 * "+15551234567" → "+1•••••4567"
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '(no phone)';
  const clean = phone.trim();
  if (clean.length <= 6) return '•'.repeat(clean.length);
  const head = clean.slice(0, 2);
  const tail = clean.slice(-4);
  return `${head}${'•'.repeat(Math.max(clean.length - 6, 3))}${tail}`;
}

/** Loose E.164 validation: + followed by 8–15 digits. */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone.trim());
}
