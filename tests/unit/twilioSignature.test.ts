import { describe, expect, it } from 'vitest';
import {
  computeTwilioSignature,
  validateTwilioSignature,
} from '../../src/server/services/twilioSignature.js';

// Vector cross-checked against the algorithm in the official twilio-node
// helper (getExpectedTwilioSignature): url + sorted(key+value) → HMAC-SHA1
// base64. Pinned here to catch regressions in our implementation.
// Algorithm reference: https://www.twilio.com/docs/usage/security#validating-requests
const AUTH_TOKEN = '12345';
const URL = 'https://mycompany.com/myapp.php?foo=1&bar=2';
const PARAMS: Record<string, string> = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+14158675310',
  Digits: '1234',
  From: '+14158675310',
  To: '+18005551212',
};
const EXPECTED = 'GvWf1cFY/Q7PnoempGyD5oXAezc=';

describe('Twilio signature validation', () => {
  it('matches the pinned known-good signature for the reference payload', () => {
    expect(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS)).toBe(EXPECTED);
  });

  it('accepts a valid signature', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, EXPECTED, URL, PARAMS)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(
      validateTwilioSignature(AUTH_TOKEN, EXPECTED, URL, { ...PARAMS, Digits: '9999' }),
    ).toBe(false);
  });

  it('rejects a wrong token, missing signature, and wrong URL', () => {
    expect(validateTwilioSignature('wrong', EXPECTED, URL, PARAMS)).toBe(false);
    expect(validateTwilioSignature(AUTH_TOKEN, undefined, URL, PARAMS)).toBe(false);
    expect(
      validateTwilioSignature(AUTH_TOKEN, EXPECTED, 'https://evil.example/webhook', PARAMS),
    ).toBe(false);
  });
});
