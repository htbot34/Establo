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
