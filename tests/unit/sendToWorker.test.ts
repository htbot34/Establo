import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigForTests } from '../../src/server/config.js';
import type { Db } from '../../src/server/db/client.js';
import { conversations, messages, orgs, workers } from '../../src/server/db/schema.js';
import { renderTemplate } from '../../src/server/services/messages.es.js';
import { sendToWorker } from '../../src/server/services/sendToWorker.js';

interface InsertedRow {
  table: unknown;
  values: Record<string, unknown>;
}

/**
 * A hand-rolled stand-in for the Drizzle `Db` that satisfies exactly the query
 * shapes sendToWorker uses (select→from→where, insert→values→returning,
 * update→set→where), routed by table identity. Lets us assert the rows
 * sendToWorker writes without a live Postgres.
 */
function makeFakeDb(worker: Record<string, unknown>) {
  const inserted: InsertedRow[] = [];
  let rowSeq = 0;
  const db = {
    select(_cols?: unknown) {
      return {
        from(table: unknown) {
          return {
            where(_cond?: unknown) {
              if (table === workers) return Promise.resolve([worker]);
              if (table === orgs) return Promise.resolve([{ pausedAt: null }]);
              if (table === conversations) return Promise.resolve([{ id: 'conv-1' }]);
              return Promise.resolve([]);
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          return {
            returning(_sel?: unknown) {
              rowSeq += 1;
              inserted.push({ table, values });
              return Promise.resolve([{ id: `row-${rowSeq}` }]);
            },
          };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(_values: unknown) {
          return {
            where(_cond?: unknown) {
              return Promise.resolve(undefined);
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as Db, inserted };
}

const baseWorker = {
  id: 'w-1',
  orgId: 'o-1',
  phoneE164: '+15125550123',
  name: 'Ana López',
  consentStatus: 'opted_in',
  status: 'active',
  lastInboundAt: null,
};

describe('sendToWorker — template send in mock mode', () => {
  it('writes one template message row carrying the rendered copy', async () => {
    const { db, inserted } = makeFakeDb({ ...baseWorker });

    const res = await sendToWorker(db, 'w-1', {
      text: '',
      template: { name: 'establo_module_notify', vars: ['Ana', 'Lección 1'] },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok send');
    expect(res.messageIds).toHaveLength(1);
    expect(res.sids[0]).toMatch(/^MOCK/);

    const msgRows = inserted.filter((r) => r.table === messages);
    expect(msgRows).toHaveLength(1);
    expect(msgRows[0].values.type).toBe('template');
    expect(msgRows[0].values.bodyText).toBe(
      renderTemplate('establo_module_notify', ['Ana', 'Lección 1']),
    );
  });
});

describe('sendToWorker — live template without a configured ContentSid', () => {
  const KEYS = [
    'RUN_MODE',
    'SESSION_SECRET',
    'TWILIO_CONTENT_SID_MODULE_NOTIFY',
    'TWILIO_CONTENT_SID_CHECK_REMINDER',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.RUN_MODE = 'sandbox'; // non-mock → Content path required
    process.env.SESSION_SECRET = 'x'.repeat(64); // required outside mock mode
    delete process.env.TWILIO_CONTENT_SID_MODULE_NOTIFY;
    delete process.env.TWILIO_CONTENT_SID_CHECK_REMINDER;
    resetConfigForTests();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetConfigForTests();
  });

  it('refuses with template_not_configured and never sends free-form', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, inserted } = makeFakeDb({ ...baseWorker });

    const res = await sendToWorker(db, 'w-1', {
      text: '',
      template: { name: 'establo_module_notify', vars: ['Ana', 'Lección 1'] },
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected a refusal');
    expect(res.reason).toBe('template_not_configured');
    expect(res.messageIds).toEqual([]);
    // The fix: no free-form Body fallback — nothing is written at all.
    expect(inserted.filter((r) => r.table === messages)).toHaveLength(0);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('establo_module_notify'));

    errSpy.mockRestore();
  });
});
