import { afterEach, describe, expect, it } from 'vitest';
import { config, resetConfigForTests } from '../../src/server/config.js';

/**
 * Twilio signature validation must be fail-closed: ON by default everywhere
 * outside mock. Sandbox used to default OFF, silently accepting forged
 * webhooks until someone remembered to flip the flag.
 */
describe('twilioValidateSignature default', () => {
  const saved = {
    RUN_MODE: process.env.RUN_MODE,
    SESSION_SECRET: process.env.SESSION_SECRET,
    TWILIO_VALIDATE_SIGNATURE: process.env.TWILIO_VALIDATE_SIGNATURE,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetConfigForTests();
  });

  it('sandbox: ON when TWILIO_VALIDATE_SIGNATURE is unset', () => {
    process.env.RUN_MODE = 'sandbox';
    process.env.SESSION_SECRET = 'test-secret';
    delete process.env.TWILIO_VALIDATE_SIGNATURE;
    resetConfigForTests();
    expect(config().twilioValidateSignature).toBe(true);
  });

  it('production: ON when unset', () => {
    process.env.RUN_MODE = 'production';
    process.env.SESSION_SECRET = 'test-secret';
    delete process.env.TWILIO_VALIDATE_SIGNATURE;
    resetConfigForTests();
    expect(config().twilioValidateSignature).toBe(true);
  });

  it('sandbox: an explicit false still relaxes it for webhook debugging', () => {
    process.env.RUN_MODE = 'sandbox';
    process.env.SESSION_SECRET = 'test-secret';
    process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
    resetConfigForTests();
    expect(config().twilioValidateSignature).toBe(false);
  });

  it('mock: effectively skipped — the webhook route only validates when !isMock', () => {
    process.env.RUN_MODE = 'mock';
    delete process.env.TWILIO_VALIDATE_SIGNATURE;
    resetConfigForTests();
    // The route guard is `!cfg.isMock && cfg.twilioValidateSignature`, so the
    // flag's value is irrelevant in mock; isMock is what matters.
    expect(config().isMock).toBe(true);
  });
});
