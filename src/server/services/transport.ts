import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { maskPhone } from '../lib/phone.js';

export interface TransportSendArgs {
  to: string; // E.164, no whatsapp: prefix
  body?: string;
  mediaUrl?: string;
  /**
   * Content-template send (business-initiated, outside the 24h window): the
   * Meta-approved template's Twilio ContentSid plus its ordered placeholder
   * values. When present, the transport sends via the Content API and never
   * sets a free-form Body (Meta rejects free-form outside the window, 63016).
   */
  template?: { contentSid: string; vars: string[] };
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
    if (!args.body && !args.mediaUrl && !args.template) {
      throw new Error('Empty outbound message');
    }
    return { sid: `MOCK${randomUUID().replace(/-/g, '').slice(0, 28)}`, status: 'delivered' };
  },
};

/** Twilio REST transport (sandbox + production). */
export const twilioTransport: Transport = {
  name: 'twilio',
  async send(args) {
    const cfg = config();
    if (!cfg.twilioAccountSid || !cfg.twilioAuthToken) {
      throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are required outside mock mode');
    }
    const form = new URLSearchParams();
    form.set('From', cfg.twilioWhatsAppFrom);
    form.set('To', `whatsapp:${args.to}`);
    if (args.template) {
      // Content API send: ContentSid selects the Meta-approved template and
      // ContentVariables fills its {{1}},{{2}},… placeholders by position.
      // Never set Body for a template — that is the free-form path Meta blocks
      // outside the 24h window (error 63016).
      form.set('ContentSid', args.template.contentSid);
      form.set(
        'ContentVariables',
        JSON.stringify(
          Object.fromEntries(args.template.vars.map((v, i) => [String(i + 1), v])),
        ),
      );
    } else {
      if (args.body) form.set('Body', args.body);
      if (args.mediaUrl) form.set('MediaUrl', args.mediaUrl);
    }
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
