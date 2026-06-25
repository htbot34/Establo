import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigForTests } from '../../src/server/config.js';
import { twilioTransport } from '../../src/server/services/transport.js';

// twilioTransport reads Twilio creds from config(), which is lazily built from
// process.env. Set them here (and reset the cache) so the live transport runs
// without a real Twilio account, then restore + unstub fetch afterward.
const ENV_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'] as const;
const saved: Record<string, string | undefined> = {};

function stubFetchOk() {
  const fetchMock = vi.fn(async (..._args: unknown[]) => ({
    ok: true,
    json: async () => ({ sid: 'SM123', status: 'queued' }),
    text: async () => '',
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The url-encoded form Twilio was POSTed, parsed back into params. */
function postedForm(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams {
  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  return new URLSearchParams(init.body);
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'tok-secret';
  process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';
  resetConfigForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigForTests();
  vi.unstubAllGlobals();
});

describe('twilioTransport — Content template send', () => {
  it('POSTs ContentSid + ContentVariables and never a Body', async () => {
    const fetchMock = stubFetchOk();

    const res = await twilioTransport.send({
      to: '+15125550123',
      template: { contentSid: 'HXabc', vars: ['Ana', 'Lección 1'] },
    });
    expect(res).toEqual({ sid: 'SM123', status: 'queued' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
    expect(init.method).toBe('POST');

    const form = new URLSearchParams(init.body);
    expect(form.get('ContentSid')).toBe('HXabc');
    expect(form.get('ContentVariables')).toBe('{"1":"Ana","2":"Lección 1"}');
    expect(form.has('Body')).toBe(false);
    expect(form.has('MediaUrl')).toBe(false);
    expect(form.get('To')).toBe('whatsapp:+15125550123');
    expect(form.get('From')).toBe('whatsapp:+14155238886');
  });

  it('still POSTs a Body and no ContentSid for a free-form send', async () => {
    const fetchMock = stubFetchOk();

    await twilioTransport.send({ to: '+15125550123', body: 'Hola Ana' });

    const form = postedForm(fetchMock);
    expect(form.get('Body')).toBe('Hola Ana');
    expect(form.has('ContentSid')).toBe(false);
    expect(form.has('ContentVariables')).toBe(false);
  });

  it('throws without Twilio credentials (unchanged behavior)', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    resetConfigForTests();
    await expect(
      twilioTransport.send({ to: '+15125550123', body: 'Hola' }),
    ).rejects.toThrow(/TWILIO_ACCOUNT_SID/);
  });
});
