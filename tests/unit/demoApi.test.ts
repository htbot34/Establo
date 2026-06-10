/**
 * The static GitHub Pages demo runs this in-browser API — make sure its
 * simulator pipeline mirrors the real one (router, guards, drip handshake).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { demoFetch, resetDemoStore } from '../../src/web/demo/demoApi';

interface SimMessage {
  direction: string;
  type: string;
  bodyText: string | null;
  transcriptText: string | null;
  audioReplyUrl: string | null;
}

async function lastMessages(workerId: string, n: number): Promise<SimMessage[]> {
  const conv = await demoFetch(`/api/simulator/conversation/${workerId}`);
  return (conv.messages as SimMessage[]).slice(-n);
}

async function workerByName(name: string): Promise<{ id: string; name: string }> {
  const workers = await demoFetch('/api/simulator/workers');
  return workers.find((w: { name: string }) => w.name.includes(name));
}

describe('static demo in-browser API', () => {
  beforeEach(() => resetDemoStore());

  it('starts signed in with the seeded demo org', async () => {
    const me = await demoFetch('/api/auth/me');
    expect(me.org.name).toBe('Rancho Vista Lechería');
    const overview = await demoFetch('/api/overview');
    expect(overview.activeWorkers).toBe(6);
    expect(overview.sparkline).toHaveLength(14);
  });

  it('answers an SOP question with an extract + citation and logs the event', async () => {
    const maria = await workerByName('María');
    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: maria.id, kind: 'text', text: '¿cuánto tiempo dejo el pre-dip?' },
    });
    const [reply] = await lastMessages(maria.id, 1);
    expect(reply.direction).toBe('outbound');
    expect(reply.bodyText).toContain('30 segundos');
    expect(reply.bodyText).toContain('📄 Fuente: Rutina de ordeño');
  });

  it('voice notes get a voice reply with the placeholder audio', async () => {
    const luz = await workerByName('Luz');
    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: luz.id, kind: 'voice', text: '¿con qué se desinfecta el ombligo?' },
    });
    const msgs = await lastMessages(luz.id, 3);
    expect(msgs.some((m) => m.direction === 'outbound' && m.type === 'voice' && m.audioReplyUrl)).toBe(true);
    expect(msgs.some((m) => m.bodyText?.includes('yodo al 7%'))).toBe(true);
  });

  it('refuses salary questions and opens an escalation', async () => {
    const carlos = await workerByName('Carlos');
    const before = (await demoFetch('/api/escalations')).length;
    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: carlos.id, kind: 'text', text: '¿me puedes subir el sueldo?' },
    });
    const [reply] = await lastMessages(carlos.id, 1);
    expect(reply.bodyText).toContain('supervisor');
    const after = await demoFetch('/api/escalations');
    expect(after.length).toBe(before + 1);
    expect(after[0].reason).toContain('Tema restringido');
  });

  it('runs the full drip handshake: enroll → closed window → template → OK → lesson → graded check', async () => {
    const ana = await workerByName('Ana');
    const tracks = await demoFetch('/api/tracks');
    await demoFetch(`/api/workers/${ana.id}/enroll`, {
      method: 'POST',
      body: { trackId: tracks[0].id },
    });
    await demoFetch('/api/simulator/close-window', { method: 'POST', body: { workerId: ana.id } });

    const tick = await demoFetch('/api/simulator/run-drip', { method: 'POST' });
    expect(tick.notified).toBeGreaterThanOrEqual(1);
    let msgs = await lastMessages(ana.id, 1);
    expect(msgs[0].type).toBe('template');
    expect(msgs[0].bodyText).toContain('Responde OK');

    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: ana.id, kind: 'text', text: 'OK' },
    });
    msgs = await lastMessages(ana.id, 3);
    expect(msgs.some((m) => m.bodyText?.includes('Lección 1 de 6'))).toBe(true);

    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: ana.id, kind: 'text', text: '2' },
    });
    msgs = await lastMessages(ana.id, 1);
    expect(msgs[0].bodyText).toContain('¡Correcto!');

    const detail = await demoFetch(`/api/workers/${ana.id}`);
    const enr = detail.enrollments[0];
    expect(enr.deliveries.filter((d: { status: string }) => d.status === 'answered')).toHaveLength(1);
  });

  it('keeps server-only features clearly unavailable', async () => {
    await expect(
      demoFetch('/api/sops/upload', { method: 'POST', body: {} }),
    ).rejects.toThrowError(/real backend/);
    const tracks = await demoFetch('/api/tracks');
    await expect(
      demoFetch(`/api/tracks/${tracks[0].id}/generate`, { method: 'POST', body: { documentId: 'x' } }),
    ).rejects.toThrowError(/Claude/);
  });
});

/**
 * The exact questions from the README script and the simulator's "Prueba:"
 * hint — what industry reviewers will type into the hosted demo. Each
 * mapping here is a promise the static demo must keep.
 */
describe('reviewer demo script — retrieval and routing', () => {
  beforeEach(() => resetDemoStore());

  async function ask(text: string): Promise<SimMessage> {
    const maria = await workerByName('María');
    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: maria.id, kind: 'text', text },
    });
    const [reply] = await lastMessages(maria.id, 1);
    return reply;
  }

  it('mastitis question → the new mastitis SOP, not "Rutina de ordeño > Secado"', async () => {
    const reply = await ask('¿qué hago si una vaca tiene mastitis?');
    expect(reply.bodyText).toContain('📄 Fuente: Detección y manejo de mastitis');
    expect(reply.bodyText).toContain('Avisa al encargado');
    expect(reply.bodyText).not.toContain('Secado');
  });

  it('wash-temperature question → a CIP cycle chunk that contains the temperatures', async () => {
    const reply = await ask('¿a qué temperatura debe estar el agua para lavar el equipo?');
    expect(reply.bodyText).toContain('📄 Fuente: Limpieza de la sala de ordeño (CIP)');
    expect(reply.bodyText).toContain('71 a 77');
  });

  it('pre-dip question → the 30-segundos pre-dip chunk', async () => {
    const reply = await ask('¿cuánto tiempo dejo el pre-dip?');
    expect(reply.bodyText).toContain('30 segundos');
    expect(reply.bodyText).toContain('📄 Fuente: Rutina de ordeño — Rutina de ordeño > Pre-dip');
  });

  it('salary question → refusal + escalation, never a citation', async () => {
    const before = (await demoFetch('/api/escalations')).length;
    const reply = await ask('¿me puedes subir el sueldo?');
    expect(reply.bodyText).toContain('supervisor');
    expect(reply.bodyText).not.toContain('📄 Fuente');
    const after = await demoFetch('/api/escalations');
    expect(after.length).toBe(before + 1);
    expect(after[0].reason).toContain('Tema restringido');
  });

  it('greeting → canned greeting, no retrieval', async () => {
    const reply = await ask('hola');
    expect(reply.bodyText).toContain('Soy Establo');
    expect(reply.bodyText).not.toContain('📄 Fuente');
  });

  it('colostrum question → the 4-litros / 22% Brix chunk', async () => {
    const reply = await ask('¿cuánto calostro le doy a un becerro recién nacido?');
    expect(reply.bodyText).toContain('4 litros');
    expect(reply.bodyText).toContain('22% Brix');
    expect(reply.bodyText).toContain('📄 Fuente: Cuidado de becerras recién nacidas');
  });

  it('vet-dosing question about mastitis → refusal, never the mastitis SOP', async () => {
    const reply = await ask('¿cuánta penicilina le doy a una vaca con mastitis?');
    expect(reply.bodyText).toContain('supervisor');
    expect(reply.bodyText).not.toContain('📄 Fuente');
    const esc = await demoFetch('/api/escalations');
    expect(esc[0].reason).toContain('Tema restringido');
  });

  it('the SOPs page lists 6 documents and the mastitis SOP has chunks', async () => {
    const sops = await demoFetch('/api/sops');
    expect(sops).toHaveLength(6);
    const mastitis = sops.find(
      (d: { title: string }) => d.title === 'Detección y manejo de mastitis',
    );
    expect(mastitis.chunkCount).toBeGreaterThan(0);
  });
});
