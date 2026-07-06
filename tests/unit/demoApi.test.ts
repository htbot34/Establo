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
    expect(overview.activeWorkers).toBe(7);
    expect(overview.sparkline).toHaveLength(14);
  });

  it('consent flow: ALTA opts Rosa in (with the one-time disclosure), BAJA opts out', async () => {
    const rosa = await workerByName('Rosa');
    let workers = await demoFetch('/api/workers');
    expect(workers.find((w: { id: string }) => w.id === rosa.id).consentStatus).toBe('pending');

    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: rosa.id, kind: 'text', text: 'ALTA' },
    });
    workers = await demoFetch('/api/workers');
    expect(workers.find((w: { id: string }) => w.id === rosa.id).consentStatus).toBe('opted_in');
    const msgs = await lastMessages(rosa.id, 3);
    expect(msgs.some((m) => m.bodyText?.includes('registros de capacitación'))).toBe(true); // disclosure
    expect(msgs.some((m) => m.bodyText?.includes('Ya estás dado de alta'))).toBe(true);

    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: rosa.id, kind: 'text', text: 'BAJA' },
    });
    workers = await demoFetch('/api/workers');
    expect(workers.find((w: { id: string }) => w.id === rosa.id).consentStatus).toBe('opted_out');
    const [confirm] = await lastMessages(rosa.id, 1);
    expect(confirm.bodyText).toContain('Ya no te mandaremos más mensajes');
  });

  it('Pedro signs the pending cow care agreement by replying ACEPTO', async () => {
    const pedro = await workerByName('Pedro');
    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: pedro.id, kind: 'text', text: 'ACEPTO' },
    });
    const [reply] = await lastMessages(pedro.id, 1);
    expect(reply.bodyText).toContain('Tu firma quedó registrada');
    const workers = await demoFetch('/api/workers');
    const row = workers.find((w: { id: string }) => w.id === pedro.id);
    expect(row.agreement).not.toBeNull();
    expect(row.agreement.method).toBe('whatsapp');
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
    const jose = await workerByName('José');
    const before = (await demoFetch('/api/escalations')).length;
    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: jose.id, kind: 'text', text: '¿me puedes subir el sueldo?' },
    });
    const [reply] = await lastMessages(jose.id, 1);
    expect(reply.bodyText).toContain('supervisor');
    const after = await demoFetch('/api/escalations');
    expect(after.length).toBe(before + 1);
    expect(after[0].reason).toContain('Tema restringido');
  });

  it('Carlos (opted out via BAJA) gets only the re-join reminder, never an answer', async () => {
    const carlos = await workerByName('Carlos');
    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: carlos.id, kind: 'text', text: '¿cuánto tiempo dejo el pre-dip?' },
    });
    const [reply] = await lastMessages(carlos.id, 1);
    expect(reply.bodyText).toContain('Estás dado de baja');
    expect(reply.bodyText).not.toContain('📄 Fuente');
  });

  it('runs the full drip handshake: enroll → closed window → template → OK → lesson → graded check', async () => {
    // Luz is an ordeño worker, so she receives the day-0 milking lesson.
    const luz = await workerByName('Luz');
    const tracks = await demoFetch('/api/tracks');
    await demoFetch(`/api/workers/${luz.id}/enroll`, {
      method: 'POST',
      body: { trackId: tracks[0].id },
    });
    await demoFetch('/api/simulator/close-window', { method: 'POST', body: { workerId: luz.id } });

    const tick = await demoFetch('/api/simulator/run-drip', { method: 'POST' });
    expect(tick.notified).toBeGreaterThanOrEqual(1);
    let msgs = await lastMessages(luz.id, 1);
    expect(msgs[0].type).toBe('template');
    expect(msgs[0].bodyText).toContain('Responde OK');

    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: luz.id, kind: 'text', text: 'OK' },
    });
    msgs = await lastMessages(luz.id, 3);
    // 8 modules in the seeded induction track (6 core + 2 curated-video
    // safety lessons added by the video-catalog layer).
    expect(msgs.some((m) => m.bodyText?.includes('Lección 1 de 8'))).toBe(true);

    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: luz.id, kind: 'text', text: '2' },
    });
    msgs = await lastMessages(luz.id, 1);
    expect(msgs[0].bodyText).toContain('¡Correcto!');

    const detail = await demoFetch(`/api/workers/${luz.id}`);
    const enr = detail.enrollments[0];
    expect(enr.deliveries.filter((d: { status: string }) => d.status === 'answered')).toHaveLength(1);
  });

  it('role-scopes enrollment: an ordeño worker and a calf-care worker get different lessons', async () => {
    const tracks = await demoFetch('/api/tracks');
    const luz = await workerByName('Luz'); // ordeño
    const ana = await workerByName('Ana'); // becerras
    await demoFetch(`/api/workers/${luz.id}/enroll`, { method: 'POST', body: { trackId: tracks[0].id } });
    await demoFetch(`/api/workers/${ana.id}/enroll`, { method: 'POST', body: { trackId: tracks[0].id } });

    const titlesFor = async (id: string): Promise<string[]> => {
      const detail = await demoFetch(`/api/workers/${id}`);
      return detail.enrollments[0].deliveries.map((d: { moduleTitle: string }) => d.moduleTitle);
    };
    const luzTitles = await titlesFor(luz.id);
    const anaTitles = await titlesFor(ana.id);

    // ordeño worker: milking lessons, not the calf-care one.
    expect(luzTitles.some((t) => t.includes('rutina de ordeño'))).toBe(true);
    expect(luzTitles.some((t) => t.includes('Calostro'))).toBe(false);
    // calf-care worker: calostro, not the milking lessons.
    expect(anaTitles.some((t) => t.includes('Calostro'))).toBe(true);
    expect(anaTitles.some((t) => t.includes('rutina de ordeño'))).toBe(false);
    // both get the universal chemical-safety lesson.
    expect(luzTitles.some((t) => t.includes('Químicos'))).toBe(true);
    expect(anaTitles.some((t) => t.includes('Químicos'))).toBe(true);
    // and the delivery counts differ.
    expect(luzTitles.length).toBe(6);
    expect(anaTitles.length).toBe(4);
  });

  it('a module with a video link emits the video line on delivery', async () => {
    const track = await demoFetch('/api/tracks', { method: 'POST', body: { name: 'Con video' } });
    await demoFetch(`/api/tracks/${track.id}/modules`, {
      method: 'POST',
      body: {
        title: 'Lección con video',
        bodyEs: 'Cuerpo de la lección.',
        checkQuestionEs: '¿Listo?',
        checkOptionsEs: ['Sí', 'No', 'Tal vez'],
        checkCorrectIndex: 0,
        dayOffset: 0,
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        videoTitleEs: 'Mi video',
      },
    });
    const luz = await workerByName('Luz');
    await demoFetch(`/api/workers/${luz.id}/enroll`, { method: 'POST', body: { trackId: track.id } });
    // Deterministic handshake (independent of the fixture's wall-clock age).
    await demoFetch('/api/simulator/close-window', { method: 'POST', body: { workerId: luz.id } });
    await demoFetch('/api/simulator/run-drip', { method: 'POST' });
    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: luz.id, kind: 'text', text: 'OK' },
    });
    const msgs = await lastMessages(luz.id, 6);
    // The lesson carries the 📚 header (the template notification never does).
    const lesson = msgs.find((m) => m.bodyText?.includes('📚 Lección'));
    expect(lesson?.bodyText).toContain('Lección con video');
    expect(lesson?.bodyText).toContain('📹 Mira el video (Mi video): https://youtu.be/dQw4w9WgXcQ');
  });

  it('a module with a video attribution delivers the credit line after the video line', async () => {
    const ATTR = '«Serie de prueba» — usado con autorización.';
    const track = await demoFetch('/api/tracks', { method: 'POST', body: { name: 'Con crédito' } });
    const created = await demoFetch(`/api/tracks/${track.id}/modules`, {
      method: 'POST',
      body: {
        title: 'Lección con crédito',
        bodyEs: 'Cuerpo de la lección.',
        checkQuestionEs: '¿Listo?',
        checkOptionsEs: ['Sí', 'No', 'Tal vez'],
        checkCorrectIndex: 0,
        dayOffset: 0,
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        videoTitleEs: 'Mi video',
        videoAttribution: ATTR,
      },
    });
    expect(created.videoAttribution).toBe(ATTR); // persisted on create

    const luz = await workerByName('Luz');
    await demoFetch(`/api/workers/${luz.id}/enroll`, { method: 'POST', body: { trackId: track.id } });
    await demoFetch('/api/simulator/close-window', { method: 'POST', body: { workerId: luz.id } });
    await demoFetch('/api/simulator/run-drip', { method: 'POST' });
    await demoFetch('/api/simulator/inbound', {
      method: 'POST',
      body: { workerId: luz.id, kind: 'text', text: 'OK' },
    });
    const msgs = await lastMessages(luz.id, 6);
    const lesson = msgs.find((m) => m.bodyText?.includes('📚 Lección'));
    expect(lesson?.bodyText).toContain('📹 Mira el video (Mi video): https://youtu.be/dQw4w9WgXcQ');
    expect(lesson?.bodyText).toContain(`ℹ️ Crédito del video: ${ATTR}`);
  });

  it('clearing a module video also clears its attribution', async () => {
    const track = await demoFetch('/api/tracks', { method: 'POST', body: { name: 'Limpia crédito' } });
    const created = await demoFetch(`/api/tracks/${track.id}/modules`, {
      method: 'POST',
      body: {
        title: 'Lección',
        bodyEs: 'Cuerpo.',
        checkQuestionEs: '¿Listo?',
        checkOptionsEs: ['Sí', 'No', 'Tal vez'],
        checkCorrectIndex: 0,
        dayOffset: 0,
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        videoAttribution: '«X» — usado con autorización.',
      },
    });
    const patched = await demoFetch(`/api/modules/${created.id}`, {
      method: 'PATCH',
      body: { videoUrl: '' },
    });
    expect(patched.videoUrl).toBeNull();
    expect(patched.videoAttribution).toBeNull();
  });

  it('refuses to enroll when no lesson in the track applies to the worker’s role', async () => {
    // A track with a single ordeño-only lesson (no universal modules) leaves a
    // calf-care worker with zero applicable lessons.
    const track = await demoFetch('/api/tracks', { method: 'POST', body: { name: 'Solo ordeño' } });
    await demoFetch(`/api/tracks/${track.id}/modules`, {
      method: 'POST',
      body: {
        title: 'Lección de ordeño',
        bodyEs: 'Pasos de ordeño.',
        checkQuestionEs: '¿Listo?',
        checkOptionsEs: ['Sí', 'No', 'Tal vez'],
        checkCorrectIndex: 0,
        dayOffset: 0,
        appliesToRoles: ['ordeno'],
      },
    });
    const ana = await workerByName('Ana'); // becerras
    await expect(
      demoFetch(`/api/workers/${ana.id}/enroll`, { method: 'POST', body: { trackId: track.id } }),
    ).rejects.toThrowError(/role/);
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

  it('English question → Spanish-only nudge, no citation and no escalation', async () => {
    const before = (await demoFetch('/api/escalations')).length;
    const reply = await ask('how long do I leave the pre-dip on the teat?');
    expect(reply.bodyText).toContain('solo contesto en español');
    expect(reply.bodyText).not.toContain('📄 Fuente');
    const after = await demoFetch('/api/escalations');
    expect(after.length).toBe(before); // a normal interaction, never a knowledge gap
  });

  it('immigration questions store only the category marker; sueldo questions stay verbatim', async () => {
    // Immigration → redacted in every employer-visible record.
    await ask('que hago si llega la migra al establo');
    let esc = await demoFetch('/api/escalations');
    expect(esc[0].questionText).toBe('Tema restringido: migración');
    expect(esc[0].questionText).not.toContain('establo');
    const maria = await workerByName('María');
    let detail = await demoFetch(`/api/workers/${maria.id}`);
    const immigrationEvents = detail.events.filter(
      (e: { questionText: string | null }) => e.questionText?.includes('llega'),
    );
    expect(immigrationEvents).toHaveLength(0);

    // Employment → verbatim (deliberately not redacted).
    const sueldo = '¿me puedes subir el sueldo este mes?';
    await ask(sueldo);
    esc = await demoFetch('/api/escalations');
    expect(esc.some((e: { questionText: string }) => e.questionText === sueldo)).toBe(true);
    detail = await demoFetch(`/api/workers/${maria.id}`);
    const sueldoEvents = detail.events.filter(
      (e: { questionText: string | null }) => e.questionText === sueldo,
    );
    expect(sueldoEvents.length).toBeGreaterThanOrEqual(2); // qa_interaction + escalation
  });

  it.each([
    ['boss when do you pay me my sueldo'],
    ['what if ICE comes to the farm'],
  ])('English forbidden topic "%s" → refusal + escalation, never the language nudge', async (text) => {
    const before = (await demoFetch('/api/escalations')).length;
    const reply = await ask(text);
    expect(reply.bodyText).not.toContain('solo contesto en español');
    expect(reply.bodyText).toContain('supervisor');
    expect(reply.bodyText).not.toContain('📄 Fuente');
    const after = await demoFetch('/api/escalations');
    expect(after.length).toBe(before + 1);
    expect(after[0].reason).toContain('Tema restringido');
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
