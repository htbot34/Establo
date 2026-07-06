import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/server/db/client.js';
import { escalations, trainingEvents } from '../../src/server/db/schema.js';
import {
  matchEscalationKeyword,
  recordKeywordEscalation,
} from '../../src/server/services/escalationKeywords.js';

/**
 * Org-configured forced-escalation keywords: matching must be forgiving on
 * accents/case (workers type without accents; managers configure with them —
 * and vice versa) but strict on word boundaries, because a short keyword
 * firing inside an everyday word would flood the supervisor with noise.
 */
describe('matchEscalationKeyword — normalization', () => {
  it('matches regardless of accents, in both directions', () => {
    expect(matchEscalationKeyword('cuidado con el acido en la sala', ['ácido'])).toBe('ácido');
    expect(matchEscalationKeyword('¿dónde guardo el ÁCIDO?', ['acido'])).toBe('acido');
  });

  it('matches regardless of case', () => {
    expect(matchEscalationKeyword('SE REGÓ EL CLORO', ['cloro'])).toBe('cloro');
    expect(matchEscalationKeyword('se regó el cloro', ['CLORO'])).toBe('CLORO');
  });

  it('returns the keyword as the manager configured it, not the normalized form', () => {
    expect(matchEscalationKeyword('problema con el amoniaco', ['Amoníaco'])).toBe('Amoníaco');
  });

  it('requires whole words — never fires inside a longer word', () => {
    expect(matchEscalationKeyword('gastamos mucho en la sala', ['gas'])).toBeNull();
    expect(matchEscalationKeyword('huele a gas en la sala', ['gas'])).toBe('gas');
  });

  it('matches multi-word keywords across extra whitespace', () => {
    expect(matchEscalationKeyword('hay fuga en la  sala de espera', ['sala de espera'])).toBe(
      'sala de espera',
    );
  });

  it('treats regex metacharacters in keywords as literals', () => {
    expect(matchEscalationKeyword('terminé el lavado (cip) hoy', ['lavado (cip)'])).toBe(
      'lavado (cip)',
    );
    expect(matchEscalationKeyword('terminamos el lavado normal', ['lavado (cip)'])).toBeNull();
  });

  it('returns the first configured keyword that matches', () => {
    expect(matchEscalationKeyword('el cloro y el acido se mezclaron', ['ácido', 'cloro'])).toBe(
      'ácido',
    );
  });

  it('leaves non-matching questions unaffected (null)', () => {
    expect(matchEscalationKeyword('¿cuántos chorros saco en el despunte?', ['ácido', 'cloro']))
      .toBeNull();
    expect(matchEscalationKeyword('¿qué hago si una vaca tiene mastitis?', [])).toBeNull();
  });

  it('ignores empty/whitespace-only configured keywords', () => {
    expect(matchEscalationKeyword('cualquier pregunta normal', ['', '   '])).toBeNull();
  });
});

interface InsertedRow {
  table: unknown;
  values: Record<string, unknown>;
}

/** Fake Db capturing insert(...).values(...) — the only shape this uses. */
function makeFakeDb() {
  const inserted: InsertedRow[] = [];
  const db = {
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          inserted.push({ table, values });
          return Promise.resolve();
        },
      };
    },
  } as unknown as Db;
  return { db, inserted };
}

describe('recordKeywordEscalation', () => {
  it('writes the escalation row with the exact configured-by-the-farm reason', async () => {
    const { db, inserted } = makeFakeDb();
    await recordKeywordEscalation(db, {
      orgId: 'org-1',
      workerId: 'w-1',
      questionText: '¿dónde guardo el ácido?',
      keyword: 'ácido',
      topic: 'Químicos y seguridad',
      farmTopic: 'safety_other',
      confidence: 'grounded',
    });

    const esc = inserted.find((r) => r.table === escalations);
    expect(esc).toBeDefined();
    expect(esc!.values).toMatchObject({
      orgId: 'org-1',
      workerId: 'w-1',
      questionText: '¿dónde guardo el ácido?',
      reason: 'Palabra clave configurada por la granja: ácido',
    });
  });

  it('logs an escalation training event alongside the row', async () => {
    const { db, inserted } = makeFakeDb();
    await recordKeywordEscalation(db, {
      orgId: 'org-1',
      workerId: 'w-1',
      questionText: '¿dónde guardo el ácido?',
      keyword: 'ácido',
      topic: 'Químicos y seguridad',
      confidence: 'grounded',
    });

    const ev = inserted.find((r) => r.table === trainingEvents);
    expect(ev).toBeDefined();
    expect(ev!.values).toMatchObject({
      orgId: 'org-1',
      workerId: 'w-1',
      eventType: 'escalation',
      topic: 'Químicos y seguridad',
      questionText: '¿dónde guardo el ácido?',
      confidence: 'grounded',
    });
  });
});
