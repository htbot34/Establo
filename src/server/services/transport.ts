import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { maskPhone } from '../lib/phone.js';

export interface TransportSendArgs {
  to: string; // E.164, no whatsapp: prefix
  body?: string;
  mediaUrl?: string;
}

export interface TransportResult {
  sid: string;
  status: string;
}

export interface Transport {
  readonly name: 'mock' | 'twilio' | 'sms-stub';
  send(args: TransportSendArgs): Promise<TransportResult>;
}

/** Mock transport: messages exist only as DB rows the simulator renders. */
const mockTransport: Transport = {
  name: 'mock',
  async send(args) {
    if (!args.body && !args.mediaUrl) throw new Error('Empty outbound message');
    return { sid: `MOCK${randomUUID().replace(/-/g, '').slice(0, 28)}`, status: 'delivered' };
  },
};

/** Twilio REST transport (sandbox + production). */
const twilioTransport: Transport = {
  name: 'twilio',
  async send(args) {
    const cfg = config();
    if (!cfg.twilioAccountSid || !cfg.twilioAuthToken) {
      throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are required outside mock mode');
    }
    const form = new URLSearchParams();
    form.set('From', cfg.twilioWhatsAppFrom);
    form.set('To', `whatsapp:${args.to}`);
    if (args.body) form.set('Body', args.body);
    if (args.mediaUrl) form.set('MediaUrl', args.mediaUrl);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilioAccountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${cfg.twilioAccountSid}:${cfg.twilioAuthToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio send to ${maskPhone(args.to)} failed (${res.status}): ${text}`);
    }
    const json = (await res.json()) as { sid: string; status: string };
    return { sid: json.sid, status: json.status };
  },
};

export function getTransport(): Transport {
  return config().isMock ? mockTransport : twilioTransport;
}

/**
 * SMS fallback seam (SMS_FALLBACK_ENABLED): when WhatsApp template delivery
 * is paused, sendToWorker hands the notification to this transport instead.
 * Stub-only — it logs what WOULD be sent; a real Twilio SMS transport plugs
 * in here later without touching sendToWorker.
 */
const smsStubTransport: Transport = {
  name: 'sms-stub',
  async send(args) {
    console.log(
      `→ [sms-stub] WhatsApp templates paused — would send SMS to ${maskPhone(args.to)}: ` +
        `${(args.body ?? '').slice(0, 80)}`,
    );
    return { sid: `SMSSTUB${randomUUID().replace(/-/g, '').slice(0, 24)}`, status: 'stubbed' };
  },
};

export function getSmsFallbackTransport(): Transport {
  return smsStubTransport;
}

/** Download a Twilio media attachment (authenticated GET, follows redirect). */
export async function downloadTwilioMedia(
  url: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const cfg = config();
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.twilioAccountSid}:${cfg.twilioAuthToken}`).toString('base64')}`,
    },
  });
  if (!res.ok) throw new Error(`Media download failed (${res.status})`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}
