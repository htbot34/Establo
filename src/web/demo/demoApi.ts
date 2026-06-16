/**
 * In-browser mock API for the static GitHub Pages demo.
 *
 * Serves the same endpoints the dashboard uses, backed by the seeded demo
 * fixture (exported from Postgres by scripts/export-demo-fixture.ts) plus
 * in-memory mutations that reset on reload. The simulator reuses the REAL
 * pure modules from the server (router, guards, topic taxonomy, canned
 * Spanish strings, 24h-window logic, schedule math) — only retrieval and
 * answer generation are simplified: answers are verbatim SOP extracts with
 * citations, since there is no Claude and no pgvector in a static page.
 */
import { ApiError } from '../api';
import { ES } from '../../server/services/messages.es';
import {
  isAceptoReply,
  parseConsentKeyword,
  renewalDue,
} from '../../server/services/consentKeywords';
import { mapToFarmTopic } from '../../server/services/farmTopics';
import { matchForbiddenTopic } from '../../server/services/guards';
import { looksSpanish } from '../../server/services/language';
import { routeInbound } from '../../server/services/router';
import { classifyTopicByKeywords } from '../../server/services/topics';
import { windowState } from '../../server/services/window';
import { computeScheduledFor } from '../../server/lib/time';
import fixtureJson from './fixture.json';
import audioManifestJson from './audioManifest.json';

type Row = Record<string, any>;

interface Store {
  authed: boolean;
  org: Row;
  user: Row;
  workers: Row[];
  documents: Row[];
  chunks: Row[];
  tracks: Row[];
  modules: Row[];
  enrollments: Row[];
  deliveries: Row[];
  events: Row[];
  conversations: Row[];
  messages: Row[];
  escalations: Row[];
  agreements: Row[];
  signatures: Row[];
  exports: Row[];
}

const fixture = fixtureJson as unknown as Omit<Store, 'authed' | 'exports'>;

let store: Store | undefined;
function db(): Store {
  if (!store) {
    const data = JSON.parse(JSON.stringify(fixture)) as typeof fixture;
    store = {
      authed: true, // the public demo starts signed in
      ...data,
      agreements: data.agreements ?? [],
      signatures: data.signatures ?? [],
      exports: [],
    };
  }
  return store;
}

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `demo-${Math.random().toString(36).slice(2)}${Date.now()}`;

const nowIso = () => new Date().toISOString();
const ts = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0);
const dateOf = (v: string | null | undefined) => (v ? new Date(v) : null);

const SILENCE_URL = './demo-silence.mp3';

// Optional pre-rendered demo audio (scripts/render-demo-audio.ts writes this
// when an OPENAI_API_KEY is present at build time). Empty by default → the demo
// serves the silent placeholder, exactly as before. Real entries are relative
// paths like "./demo-audio/module-<id>.ogg".
const audioManifest = audioManifestJson as Record<string, string>;
const DEMO_AUDIO_PREFIX = './demo-audio/';

/** Pre-rendered lesson audio for a module, or the silent placeholder. */
function moduleAudioUrl(moduleId: string): string {
  return audioManifest[`module:${moduleId}`] ?? SILENCE_URL;
}

function fail(status: number, message: string): never {
  throw new ApiError(message, status);
}

// ── tiny extractive retrieval (token + trigram overlap, accent-insensitive) ──
function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ');
}
const STOP = new Set(
  'el la los las un una de del al a en y o u que se su sus con por para como es son fue ser estar esta este esto hay si no mas pero cuando donde cual cuales quien debe deben cada lo le mi tu sale'.split(' '),
);
function tokens(text: string): string[] {
  return norm(text)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}
function scoreChunk(qTokens: string[], chunk: Row): number {
  const heading = norm(chunk.headingPath);
  const hay = `${heading} ${norm(chunk.content)}`;
  const hayTokens = new Set(hay.split(/\s+/));
  let score = 0;
  const unmatched = new Set(qTokens);
  for (const t of qTokens) {
    if (hayTokens.has(t)) score += 2;
    else if (t.length >= 5 && hay.includes(t.slice(0, 5))) score += 0.7; // stem-ish
    else continue;
    unmatched.delete(t);
  }
  // Heading words are the strongest relevance signal (they become the
  // citation). When a query token reaches a heading word only through a
  // shared 4-char stem ("lavar" → "Lavado") the loop above misses it, so
  // credit each such heading word — but never double-count tokens the text
  // already matched, which would let an incidental heading word (e.g.
  // "Equipo de protección") outrank the chunk that answers the question.
  for (const h of heading.split(/\s+/)) {
    if (h.length < 5) continue;
    for (const t of unmatched) {
      if (t.length >= 5 && t.slice(0, 4) === h.slice(0, 4)) {
        score += 0.5;
        break;
      }
    }
  }
  return qTokens.length ? score / qTokens.length : 0;
}
function retrieve(question: string): { chunk: Row; doc: Row; score: number } | null {
  const s = db();
  const q = tokens(question);
  let best: { chunk: Row; doc: Row; score: number } | null = null;
  for (const chunk of s.chunks) {
    const score = scoreChunk(q, chunk);
    if (!best || score > best.score) {
      const doc = s.documents.find((d) => d.id === chunk.documentId)!;
      best = { chunk, doc, score };
    }
  }
  return best && best.score >= 0.55 ? best : null;
}

// ── shared helpers ────────────────────────────────────────────────────────────
function conversationFor(workerId: string): Row {
  const s = db();
  let conv = s.conversations.find((c) => c.workerId === workerId);
  if (!conv) {
    conv = {
      id: uuid(),
      workerId,
      orgId: s.org.id,
      startedAt: nowIso(),
      lastMessageAt: nowIso(),
      createdAt: nowIso(),
    };
    s.conversations.push(conv);
  }
  return conv;
}

function pushMessage(
  workerId: string,
  msg: Partial<Row> & { direction: 'inbound' | 'outbound'; type: string },
): Row {
  const s = db();
  const conv = conversationFor(workerId);
  const row = {
    id: uuid(),
    conversationId: conv.id,
    orgId: s.org.id,
    bodyText: null,
    transcriptText: null,
    mediaUrl: null,
    audioReplyUrl: null,
    twilioSid: `DEMO${Date.now()}`,
    status: msg.direction === 'inbound' ? 'received' : 'delivered',
    createdAt: nowIso(),
    ...msg,
  };
  s.messages.push(row);
  conv.lastMessageAt = row.createdAt;
  return row;
}

function logEvent(workerId: string, ev: Partial<Row> & { eventType: string; topic: string }): void {
  const s = db();
  s.events.push({
    id: uuid(),
    orgId: s.org.id,
    workerId,
    occurredAt: nowIso(),
    farmTopic: 'none',
    questionText: null,
    answerText: null,
    sourceDocumentId: null,
    sourceChunkIds: null,
    confidence: null,
    createdAt: nowIso(),
    ...ev,
  });
}

function activeAgreement(): Row {
  const s = db();
  let a = s.agreements.find((x) => x.active);
  if (!a) {
    a = { id: uuid(), orgId: s.org.id, type: 'cow_care', version: 1, textEs: 'ACUERDO DE CUIDADO DE LAS VACAS', active: true, createdAt: nowIso() };
    s.agreements.push(a);
  }
  return a;
}

function latestSignature(workerId: string): Row | null {
  const sigs = db()
    .signatures.filter((x) => x.workerId === workerId)
    .sort((a, b) => ts(b.signedAt) - ts(a.signedAt));
  return sigs[0] ?? null;
}

function addEscalation(workerId: string, questionText: string, reason: string): void {
  const s = db();
  s.escalations.push({
    id: uuid(),
    orgId: s.org.id,
    workerId,
    questionText,
    reason,
    status: 'open',
    resolvedBy: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

// ── drip engine mirror ───────────────────────────────────────────────────────
function deliverModule(delivery: Row): boolean {
  const s = db();
  if (delivery.status === 'sent' || delivery.status === 'answered') return false;
  const module = s.modules.find((m) => m.id === delivery.moduleId)!;
  const enrollment = s.enrollments.find((e) => e.id === delivery.enrollmentId)!;
  const total = s.modules.filter((m) => m.trackId === module.trackId).length;
  const text = [
    ES.moduleHeader(module.orderIndex + 1, total, module.title),
    '',
    module.bodyEs,
    '',
    ES.checkPrompt(module.checkQuestionEs, module.checkOptionsEs),
  ].join('\n');
  pushMessage(enrollment.workerId, { direction: 'outbound', type: 'text', bodyText: text });
  pushMessage(enrollment.workerId, { direction: 'outbound', type: 'voice', audioReplyUrl: moduleAudioUrl(module.id) });
  delivery.status = 'sent';
  delivery.sentAt = nowIso();
  logEvent(enrollment.workerId, {
    eventType: 'module_delivered',
    topic: classifyTopicByKeywords(`${module.title} ${module.bodyEs}`),
    farmTopic: module.farmTopic ?? 'none',
    answerText: `Módulo entregado: ${module.title}`,
    sourceDocumentId: module.sourceDocumentId,
    confidence: 'grounded',
  });
  return true;
}

function runDrip(): { delivered: number; notified: number; reminded: number } {
  const s = db();
  const now = new Date();
  const result = { delivered: 0, notified: 0, reminded: 0 };
  for (const d of s.deliveries) {
    if (d.status !== 'pending' || ts(d.scheduledFor) > now.getTime()) continue;
    const enr = s.enrollments.find((e) => e.id === d.enrollmentId);
    if (!enr || enr.status !== 'active') continue;
    const worker = s.workers.find((w) => w.id === enr.workerId);
    if (!worker || worker.status !== 'active') continue;
    if ((worker.consentStatus ?? 'opted_in') !== 'opted_in') continue; // Meta opt-in gate
    if (windowState(dateOf(worker.lastInboundAt), now) === 'open') {
      if (deliverModule(d)) result.delivered++;
    } else {
      const module = s.modules.find((m) => m.id === d.moduleId)!;
      pushMessage(worker.id, {
        direction: 'outbound',
        type: 'template',
        bodyText: `Hola ${firstName(worker.name)}, tienes una lección de capacitación nueva: "${module.title}". Responde OK para recibirla.`,
      });
      d.status = 'notified';
      result.notified++;
    }
  }
  return result;
}

function deliverNotified(workerId: string): number {
  const s = db();
  let n = 0;
  for (const d of s.deliveries) {
    if (d.status !== 'notified') continue;
    const enr = s.enrollments.find((e) => e.id === d.enrollmentId);
    if (enr?.workerId === workerId && enr.status === 'active' && deliverModule(d)) n++;
  }
  return n;
}

function pendingCheck(workerId: string): { delivery: Row; module: Row } | null {
  const s = db();
  const candidates = s.deliveries
    .filter((d) => {
      if (d.status !== 'sent' || d.checkAnsweredAt) return false;
      const enr = s.enrollments.find((e) => e.id === d.enrollmentId);
      return enr?.workerId === workerId && enr.status === 'active';
    })
    .sort((a, b) => ts(a.sentAt) - ts(b.sentAt));
  const last = candidates[candidates.length - 1];
  return last ? { delivery: last, module: db().modules.find((m) => m.id === last.moduleId)! } : null;
}

function gradeCheck(workerId: string, ctx: { delivery: Row; module: Row }, answerIndex: number, wasVoice: boolean): void {
  const s = db();
  const { delivery, module } = ctx;
  const passed = answerIndex === module.checkCorrectIndex;
  delivery.status = 'answered';
  delivery.checkAnsweredAt = nowIso();
  delivery.checkAnswerIndex = answerIndex;
  delivery.checkPassed = passed;
  const reply = passed
    ? ES.checkCorrect
    : ES.checkIncorrect(module.checkCorrectIndex + 1, module.checkOptionsEs[module.checkCorrectIndex]);
  pushMessage(workerId, { direction: 'outbound', type: 'text', bodyText: reply });
  if (wasVoice) pushMessage(workerId, { direction: 'outbound', type: 'voice', audioReplyUrl: SILENCE_URL });
  logEvent(workerId, {
    eventType: passed ? 'check_passed' : 'check_failed',
    topic: classifyTopicByKeywords(`${module.title} ${module.bodyEs}`),
    farmTopic: module.farmTopic ?? 'none',
    questionText: module.checkQuestionEs,
    answerText: `Respuesta: ${answerIndex + 1}) ${module.checkOptionsEs[answerIndex] ?? ''}`,
    sourceDocumentId: module.sourceDocumentId,
    confidence: 'grounded',
  });
  // completion
  const enr = s.enrollments.find((e) => e.id === delivery.enrollmentId)!;
  const remaining = s.deliveries.filter((d) => d.enrollmentId === enr.id && !d.checkAnsweredAt);
  if (remaining.length === 0) {
    enr.status = 'completed';
    const track = s.tracks.find((t) => t.id === enr.trackId);
    const worker = s.workers.find((w) => w.id === workerId)!;
    pushMessage(workerId, {
      direction: 'outbound',
      type: 'text',
      bodyText: ES.trackComplete(firstName(worker.name), track?.name ?? 'de capacitación'),
    });
  }
}

// ── the inbound pipeline mirror ──────────────────────────────────────────────
function handleInbound(workerId: string, kind: 'text' | 'voice', text: string): void {
  const s = db();
  const worker = s.workers.find((w) => w.id === workerId);
  if (!worker) fail(404, 'Worker not found');
  const wasVoice = kind === 'voice';
  worker.lastInboundAt = nowIso();

  pushMessage(workerId, {
    direction: 'inbound',
    type: kind,
    bodyText: wasVoice ? null : text,
    transcriptText: wasVoice ? text : null,
    mediaUrl: wasVoice ? 'demo://voice-note' : null,
  });

  const sendDisclosureIfNeeded = () => {
    if (worker.disclosureSentAt) return;
    pushMessage(workerId, { direction: 'outbound', type: 'text', bodyText: ES.disclosure(s.org.name) });
    worker.disclosureSentAt = nowIso();
  };

  // ── Consent first: ALTA/BAJA always win (mirror of processInbound) ──
  const keyword = parseConsentKeyword(text);
  if (keyword === 'baja') {
    worker.consentStatus = 'opted_out';
    worker.consentedAt = nowIso();
    worker.consentMethod = 'whatsapp_keyword';
    pushMessage(workerId, { direction: 'outbound', type: 'text', bodyText: ES.optOutConfirm });
    return;
  }
  if (keyword === 'alta') {
    if (worker.consentStatus !== 'opted_in') {
      worker.consentStatus = 'opted_in';
      worker.consentedAt = nowIso();
      worker.consentMethod = 'whatsapp_keyword';
    }
    sendDisclosureIfNeeded();
    pushMessage(workerId, { direction: 'outbound', type: 'text', bodyText: ES.optInConfirm });
    return;
  }
  if (worker.consentStatus === 'opted_out') {
    pushMessage(workerId, { direction: 'outbound', type: 'text', bodyText: ES.optedOutReminder });
    return;
  }
  if ((worker.consentStatus ?? 'opted_in') === 'pending') {
    worker.consentStatus = 'opted_in';
    worker.consentedAt = nowIso();
    worker.consentMethod = 'whatsapp_keyword';
  }
  sendDisclosureIfNeeded();

  // ── Cow care agreement: deliver if queued; ACEPTO signs; else nudge → escalate ──
  let agreementJustDelivered = false;
  if (worker.pendingAgreementId && !worker.pendingAgreementSentAt) {
    const agreement = s.agreements.find((a) => a.id === worker.pendingAgreementId) ?? activeAgreement();
    pushMessage(workerId, {
      direction: 'outbound',
      type: 'text',
      bodyText: [ES.agreementIntro(s.org.name), '', agreement.textEs].join('\n'),
    });
    worker.pendingAgreementSentAt = nowIso();
    agreementJustDelivered = true;
  }
  if (!agreementJustDelivered && worker.pendingAgreementId && worker.pendingAgreementSentAt) {
    if (isAceptoReply(text)) {
      const agreement = s.agreements.find((a) => a.id === worker.pendingAgreementId) ?? activeAgreement();
      s.signatures.push({
        id: uuid(),
        orgId: s.org.id,
        workerId,
        agreementId: agreement.id,
        agreementVersion: agreement.version,
        signedAt: nowIso(),
        method: 'whatsapp',
        attestedBy: null,
        createdAt: nowIso(),
      });
      worker.pendingAgreementId = null;
      worker.pendingAgreementSentAt = null;
      worker.pendingAgreementNudges = 0;
      pushMessage(workerId, {
        direction: 'outbound',
        type: 'text',
        bodyText: ES.agreementSigned(agreement.version),
      });
      return;
    }
    if ((worker.pendingAgreementNudges ?? 0) === 0) {
      worker.pendingAgreementNudges = 1;
      pushMessage(workerId, { direction: 'outbound', type: 'text', bodyText: ES.agreementClarify });
    } else {
      worker.pendingAgreementId = null;
      worker.pendingAgreementSentAt = null;
      worker.pendingAgreementNudges = 0;
      addEscalation(workerId, text, 'No confirmó el acuerdo de cuidado de las vacas (sin ACEPTO)');
      pushMessage(workerId, { direction: 'outbound', type: 'text', bodyText: ES.agreementEscalated });
    }
  }

  const deliveredNow = deliverNotified(workerId);
  const pending = pendingCheck(workerId);
  const route = routeInbound({ text, pendingCheckOptions: pending ? pending.module.checkOptionsEs : null });

  const replyText = (body: string) => {
    pushMessage(workerId, { direction: 'outbound', type: 'text', bodyText: body });
    if (wasVoice) pushMessage(workerId, { direction: 'outbound', type: 'voice', audioReplyUrl: SILENCE_URL });
  };

  switch (route.kind) {
    case 'empty':
      if (wasVoice) replyText('No te escuché bien 🙏 ¿Me lo puedes mandar otra vez?');
      return;
    case 'check_answer':
      gradeCheck(workerId, pending!, route.checkIndex!, wasVoice);
      return;
    case 'ok_ack':
      if (deliveredNow > 0) return;
      replyText('👍 Aquí ando. Mándame tu pregunta por texto o audio cuando quieras.');
      return;
    case 'greeting':
      replyText(ES.greeting(firstName(worker.name)));
      return;
    case 'help':
      addEscalation(workerId, text, 'El trabajador pidió ayuda directamente');
      logEvent(workerId, { eventType: 'escalation', topic: 'Otro', questionText: text, confidence: 'not_found' });
      replyText(ES.helpEscalated);
      return;
    case 'question': {
      // Mirror of processInbound: a non-Spanish free-form question gets the
      // Spanish-only nudge (a normal interaction, not an escalation) instead of
      // running retrieval.
      if (!looksSpanish(text)) {
        replyText(ES.spanishOnly);
        logEvent(workerId, {
          eventType: 'qa_interaction',
          topic: 'Otro',
          questionText: text,
          answerText: ES.spanishOnly,
          confidence: null,
        });
        return;
      }
      const guard = matchForbiddenTopic(text);
      if (guard) {
        replyText(ES.forbidden);
        logEvent(workerId, {
          eventType: 'qa_interaction',
          topic: guard.topic,
          questionText: text,
          answerText: ES.forbidden,
          confidence: 'not_found',
        });
        addEscalation(workerId, text, 'Tema restringido (sueldo/legal/migración/dosis)');
        logEvent(workerId, { eventType: 'escalation', topic: guard.topic, questionText: text, confidence: 'not_found' });
        return;
      }
      const hit = retrieve(text);
      if (!hit) {
        replyText(ES.notFound);
        logEvent(workerId, {
          eventType: 'qa_interaction',
          topic: classifyTopicByKeywords(text),
          questionText: text,
          answerText: ES.notFound,
          confidence: 'not_found',
        });
        addEscalation(workerId, text, 'No encontrado en los SOPs');
        logEvent(workerId, {
          eventType: 'escalation',
          topic: classifyTopicByKeywords(text),
          questionText: text,
          confidence: 'not_found',
        });
        return;
      }
      const excerpt =
        hit.chunk.content.length > 420 ? `${hit.chunk.content.slice(0, 420)}…` : hit.chunk.content;
      const answer = `${excerpt}\n\n📄 Fuente: ${hit.doc.title} — ${hit.chunk.headingPath}`;
      replyText(answer);
      logEvent(workerId, {
        eventType: 'qa_interaction',
        topic: classifyTopicByKeywords(`${text} ${hit.chunk.headingPath}`),
        farmTopic: mapToFarmTopic(classifyTopicByKeywords(`${text} ${hit.chunk.headingPath}`), text),
        questionText: text,
        answerText: answer,
        sourceDocumentId: hit.doc.id,
        confidence: 'grounded',
      });
      return;
    }
  }
}

// ── view assembly shared with several endpoints ──────────────────────────────
function workerListItem(w: Row) {
  const s = db();
  const enrs = s.enrollments
    .filter((e) => e.workerId === w.id)
    .sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
  const e = enrs[0];
  const track = e ? s.tracks.find((t) => t.id === e.trackId) : null;
  const ds = e ? s.deliveries.filter((d) => d.enrollmentId === e.id) : [];
  const sig = latestSignature(w.id);
  return {
    ...w,
    enrollment: e
      ? {
          id: e.id,
          trackName: track?.name ?? '',
          status: e.status,
          modulesAnswered: ds.filter((d) => d.status === 'answered').length,
          modulesTotal: ds.length,
        }
      : null,
    agreement: sig
      ? {
          signedAt: sig.signedAt,
          version: sig.agreementVersion,
          method: sig.method,
          renewalDue: renewalDue(new Date(sig.signedAt)),
        }
      : null,
  };
}

function rewriteAudio(m: Row): Row {
  if (!m.audioReplyUrl) return { ...m, audioReplyUrl: null };
  // Pre-rendered demo audio is real and playable; everything else (seed TTS
  // placeholders, runtime replies) collapses to the silent placeholder.
  if (String(m.audioReplyUrl).startsWith(DEMO_AUDIO_PREFIX)) return m;
  return { ...m, audioReplyUrl: SILENCE_URL };
}

// ── the dispatcher ───────────────────────────────────────────────────────────
export async function demoFetch(path: string, opts: { method?: string; body?: unknown } = {}): Promise<any> {
  const s = db();
  const method = (opts.method ?? 'GET').toUpperCase();
  const [pathname] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(path.split('?')[1] ?? ''));
  const body = (opts.body ?? {}) as Row;
  const seg = pathname.split('/').filter(Boolean); // e.g. ['api','workers',':id']
  const route = `${method} ${pathname}`;
  const requireAuth = () => {
    if (!s.authed) fail(401, 'Not authenticated');
  };

  // ── public ──
  if (route === 'GET /healthz') return { ok: true, mode: 'demo', time: nowIso() };
  if (route === 'POST /api/auth/login') {
    if (body.email === s.user.email && body.password === 'establo-demo-2026') {
      s.authed = true;
      return { user: s.user, org: s.org };
    }
    fail(401, 'This is the hosted demo — sign in with the demo account shown below.');
  }
  if (route === 'POST /api/auth/logout') {
    s.authed = false;
    return { ok: true };
  }
  if (route === 'GET /api/auth/me') {
    if (!s.authed) fail(401, 'Not authenticated');
    return { user: s.user, org: s.org };
  }
  if (route === 'POST /api/auth/setup') {
    fail(400, 'This static demo has a single sample dairy — sign in with the demo account instead.');
  }

  requireAuth();

  // ── overview ──
  if (route === 'GET /api/overview') {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: s.org.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const byDay = new Map<string, number>();
    for (const ev of s.events) {
      const key = fmt.format(new Date(ev.occurredAt));
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const sparkline = [];
    for (let i = 13; i >= 0; i--) {
      const key = fmt.format(new Date(Date.now() - i * 86_400_000));
      sparkline.push({ date: key, count: byDay.get(key) ?? 0 });
    }
    return {
      activeWorkers: s.workers.filter((w) => w.status === 'active').length,
      questionsThisWeek: s.events.filter((e) => e.eventType === 'qa_interaction' && ts(e.occurredAt) > weekAgo).length,
      modulesDeliveredThisWeek: s.events.filter((e) => e.eventType === 'module_delivered' && ts(e.occurredAt) > weekAgo).length,
      openKnowledgeGaps: s.escalations.filter((e) => e.status === 'open').length,
      sparkline,
      recentEscalations: [...s.escalations]
        .sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
        .slice(0, 6)
        .map((e) => ({
          id: e.id,
          workerName: s.workers.find((w) => w.id === e.workerId)?.name ?? '',
          questionText: e.questionText,
          reason: e.reason,
          status: e.status,
          createdAt: e.createdAt,
        })),
    };
  }

  // ── SOPs ──
  if (route === 'GET /api/sops') {
    return s.documents.map((d) => ({
      ...d,
      chunkCount: s.chunks.filter((c) => c.documentId === d.id).length,
    }));
  }
  if (method === 'GET' && seg[1] === 'sops' && seg[2]) {
    const doc = s.documents.find((d) => d.id === seg[2]) ?? fail(404, 'Document not found');
    return {
      ...doc,
      chunks: s.chunks.filter((c) => c.documentId === doc.id).sort((a, b) => a.chunkIndex - b.chunkIndex),
    };
  }
  if (method === 'DELETE' && seg[1] === 'sops' && seg[2]) {
    s.documents = s.documents.filter((d) => d.id !== seg[2]);
    s.chunks = s.chunks.filter((c) => c.documentId !== seg[2]);
    return { ok: true };
  }
  if (route === 'POST /api/sops/upload' || (seg[1] === 'sops' && seg[3] === 'reingest')) {
    fail(400, 'Document uploads need the real backend — this hosted demo is read-only. Run Establo locally (README quickstart) to ingest your own SOPs.');
  }

  // ── workers ──
  if (route === 'GET /api/workers') {
    return [...s.workers].sort((a, b) => a.name.localeCompare(b.name)).map(workerListItem);
  }
  if (route === 'POST /api/workers') {
    if (!body.name || !/^\+[1-9]\d{7,14}$/.test(body.phoneE164 ?? '')) {
      fail(400, 'Phone must be E.164 format, e.g. +12085551234');
    }
    if (s.workers.some((w) => w.phoneE164 === body.phoneE164)) {
      fail(409, 'A worker with that phone number already exists');
    }
    const row = {
      id: uuid(),
      orgId: s.org.id,
      name: body.name,
      phoneE164: body.phoneE164,
      preferredLanguage: 'es',
      status: 'active',
      hiredAt: nowIso(),
      lastInboundAt: null,
      notes: body.notes ?? null,
      consentStatus: 'pending', // adding a worker is NOT opt-in (Meta policy)
      consentedAt: null,
      consentMethod: null,
      consentAttestedBy: null,
      disclosureSentAt: null,
      pendingAgreementId: null,
      pendingAgreementSentAt: null,
      pendingAgreementNudges: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    s.workers.push(row);
    return row;
  }
  if (seg[1] === 'workers' && seg[2] && seg[3] === 'enroll' && method === 'POST') {
    const worker = s.workers.find((w) => w.id === seg[2]) ?? fail(404, 'Worker not found');
    const track = s.tracks.find((t) => t.id === body.trackId) ?? fail(404, 'Track not found');
    const existing = s.enrollments.find(
      (e) => e.workerId === worker.id && e.trackId === track.id && e.status === 'active',
    );
    if (existing) return { enrollmentId: existing.id, created: false };
    const startedAt = new Date();
    const enr = {
      id: uuid(),
      workerId: worker.id,
      trackId: track.id,
      orgId: s.org.id,
      startedAt: startedAt.toISOString(),
      status: 'active',
      createdAt: nowIso(),
    };
    s.enrollments.push(enr);
    for (const m of s.modules.filter((m) => m.trackId === track.id)) {
      s.deliveries.push({
        id: uuid(),
        enrollmentId: enr.id,
        moduleId: m.id,
        orgId: s.org.id,
        scheduledFor: computeScheduledFor(startedAt, m.dayOffset, m.sendHourLocal, s.org.timezone).toISOString(),
        status: 'pending',
        sentAt: null,
        checkAnsweredAt: null,
        checkAnswerIndex: null,
        checkPassed: null,
        retryCount: 0,
        createdAt: nowIso(),
      });
    }
    return { enrollmentId: enr.id, created: true };
  }
  if (seg[1] === 'workers' && seg[2] && !seg[3] && method === 'GET') {
    const worker = s.workers.find((w) => w.id === seg[2]) ?? fail(404, 'Worker not found');
    const docTitle = new Map(s.documents.map((d) => [d.id, d.title]));
    const enrollments = s.enrollments
      .filter((e) => e.workerId === worker.id)
      .sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
      .map((e) => ({
        id: e.id,
        trackName: s.tracks.find((t) => t.id === e.trackId)?.name ?? '',
        status: e.status,
        startedAt: e.startedAt,
        signedOffAt: e.signedOffAt ?? null,
        signedOffName: e.signedOffName ?? null,
        signedOffRole: e.signedOffRole ?? null,
        certificateUrl: null, // PDF generation lives on the real backend
        deliveries: s.deliveries
          .filter((d) => d.enrollmentId === e.id)
          .map((d) => {
            const m = s.modules.find((m) => m.id === d.moduleId)!;
            return {
              id: d.id,
              moduleTitle: m.title,
              orderIndex: m.orderIndex,
              status: d.status,
              scheduledFor: d.scheduledFor,
              sentAt: d.sentAt,
              checkAnsweredAt: d.checkAnsweredAt,
              checkPassed: d.checkPassed,
            };
          })
          .sort((a, b) => a.orderIndex - b.orderIndex),
      }));
    const events = s.events
      .filter((e) => e.workerId === worker.id)
      .sort((a, b) => ts(b.occurredAt) - ts(a.occurredAt))
      .slice(0, 300)
      .map((e) => ({ ...e, sourceDocumentTitle: e.sourceDocumentId ? (docTitle.get(e.sourceDocumentId) ?? null) : null }));
    const sig = latestSignature(worker.id);
    const agreementStatus = {
      signed: !!sig,
      signedAt: sig?.signedAt ?? null,
      version: sig?.agreementVersion ?? null,
      method: sig?.method ?? null,
      renewalDue: sig ? renewalDue(new Date(sig.signedAt)) : false,
      pendingSince: worker.pendingAgreementSentAt ?? null,
    };
    return { ...worker, agreementStatus, enrollments, events };
  }
  if (seg[1] === 'workers' && seg[2] && method === 'PATCH') {
    const worker = s.workers.find((w) => w.id === seg[2]) ?? fail(404, 'Worker not found');
    Object.assign(worker, body, { updatedAt: nowIso() });
    return worker;
  }

  // ── consent / agreement / sign-off (compliance) ──
  if (seg[1] === 'workers' && seg[2] && seg[3] === 'consent' && seg[4] === 'paper' && method === 'POST') {
    const worker = s.workers.find((w) => w.id === seg[2]) ?? fail(404, 'Worker not found');
    if (!body.attestedBy || String(body.attestedBy).trim().length < 2) {
      fail(400, 'Type your name to attest the paper consent form');
    }
    if (worker.consentStatus === 'opted_out') {
      fail(409, 'This worker opted out on WhatsApp (BAJA). Only the worker can rejoin, by texting ALTA.');
    }
    worker.consentStatus = 'opted_in';
    worker.consentMethod = 'paper_form';
    worker.consentedAt = nowIso();
    worker.consentAttestedBy = String(body.attestedBy).trim();
    return worker;
  }
  if (route === 'GET /api/agreement') return activeAgreement();
  if (route === 'PATCH /api/agreement') {
    const current = activeAgreement();
    if (body.textEs && body.textEs !== current.textEs) {
      current.active = false;
      const next = {
        id: uuid(), orgId: s.org.id, type: 'cow_care', version: current.version + 1,
        textEs: body.textEs, active: true, createdAt: nowIso(),
      };
      s.agreements.push(next);
      return next;
    }
    return current;
  }
  if (seg[1] === 'workers' && seg[2] && seg[3] === 'agreement' && seg[4] === 'send' && method === 'POST') {
    const worker = s.workers.find((w) => w.id === seg[2]) ?? fail(404, 'Worker not found');
    if ((worker.consentStatus ?? 'opted_in') !== 'opted_in') {
      fail(409, 'Worker has not opted in to WhatsApp messages — the agreement cannot be sent.');
    }
    const agreement = activeAgreement();
    worker.pendingAgreementId = agreement.id;
    worker.pendingAgreementNudges = 0;
    if (windowState(dateOf(worker.lastInboundAt), new Date()) === 'open') {
      worker.pendingAgreementSentAt = nowIso();
      pushMessage(worker.id, {
        direction: 'outbound',
        type: 'text',
        bodyText: [ES.agreementIntro(s.org.name), '', agreement.textEs].join('\n'),
      });
      return { outcome: 'sent' };
    }
    worker.pendingAgreementSentAt = null;
    return { outcome: 'queued' };
  }
  if (seg[1] === 'workers' && seg[2] && seg[3] === 'agreement' && seg[4] === 'paper' && method === 'POST') {
    const worker = s.workers.find((w) => w.id === seg[2]) ?? fail(404, 'Worker not found');
    if (!body.attestedBy || String(body.attestedBy).trim().length < 2) {
      fail(400, 'Type your name to attest the paper signature');
    }
    const agreement = activeAgreement();
    const sig = {
      id: uuid(), orgId: s.org.id, workerId: worker.id, agreementId: agreement.id,
      agreementVersion: agreement.version, signedAt: nowIso(), method: 'paper',
      attestedBy: String(body.attestedBy).trim(), createdAt: nowIso(),
    };
    s.signatures.push(sig);
    worker.pendingAgreementId = null;
    worker.pendingAgreementSentAt = null;
    worker.pendingAgreementNudges = 0;
    return sig;
  }
  if (seg[1] === 'enrollments' && seg[2] && seg[3] === 'signoff' && method === 'POST') {
    const enr = s.enrollments.find((e) => e.id === seg[2]) ?? fail(404, 'Enrollment not found');
    if (enr.status !== 'completed') fail(409, 'Only completed tracks can be signed off');
    if (enr.signedOffAt) fail(409, 'Already signed off');
    enr.signedOffAt = nowIso();
    enr.signedOffName = s.user.name;
    enr.signedOffRole = s.user.role;
    return enr;
  }
  if (route === 'GET /api/alerts') return { templatePausedAt: null, templatePauseReason: null };
  if (route === 'POST /api/alerts/templates/acknowledge') return { ok: true };

  // ── tracks & modules ──
  if (route === 'GET /api/tracks') {
    return s.tracks.map((t) => ({
      ...t,
      moduleCount: s.modules.filter((m) => m.trackId === t.id).length,
      activeEnrollments: s.enrollments.filter((e) => e.trackId === t.id && e.status === 'active').length,
      completedEnrollments: s.enrollments.filter((e) => e.trackId === t.id && e.status === 'completed').length,
    }));
  }
  if (route === 'POST /api/tracks') {
    const row = {
      id: uuid(),
      orgId: s.org.id,
      name: body.name,
      description: body.description ?? null,
      active: true,
      createdAt: nowIso(),
    };
    s.tracks.push(row);
    return row;
  }
  if (seg[1] === 'tracks' && seg[2] && seg[3] === 'generate') {
    fail(400, 'Drafting modules uses Claude on the real backend — not available in this static demo.');
  }
  if (seg[1] === 'tracks' && seg[2] && seg[3] === 'modules' && method === 'POST') {
    const track = s.tracks.find((t) => t.id === seg[2]) ?? fail(404, 'Track not found');
    const max = Math.max(-1, ...s.modules.filter((m) => m.trackId === track.id).map((m) => m.orderIndex));
    const row = { id: uuid(), trackId: track.id, orgId: s.org.id, orderIndex: max + 1, sourceDocumentId: null, ...body };
    s.modules.push(row);
    return row;
  }
  if (seg[1] === 'tracks' && seg[2] && seg[3] === 'reorder' && method === 'POST') {
    let idx = 0;
    for (const id of body.moduleIds as string[]) {
      const m = s.modules.find((m) => m.id === id && m.trackId === seg[2]);
      if (m) m.orderIndex = idx++;
    }
    return { ok: true };
  }
  if (seg[1] === 'tracks' && seg[2] && !seg[3]) {
    const track = s.tracks.find((t) => t.id === seg[2]) ?? fail(404, 'Track not found');
    if (method === 'PATCH') Object.assign(track, body);
    return {
      ...track,
      modules: s.modules.filter((m) => m.trackId === track.id).sort((a, b) => a.orderIndex - b.orderIndex),
    };
  }
  if (seg[1] === 'modules' && seg[2]) {
    const module = s.modules.find((m) => m.id === seg[2]) ?? fail(404, 'Module not found');
    if (method === 'DELETE') {
      s.modules = s.modules.filter((m) => m.id !== module.id);
      return { ok: true };
    }
    Object.assign(module, body);
    return module;
  }

  // ── conversations & escalations ──
  if (route === 'GET /api/conversations') {
    return [...s.conversations]
      .sort((a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt))
      .map((c) => {
        const w = s.workers.find((w) => w.id === c.workerId);
        return {
          id: c.id,
          workerId: c.workerId,
          workerName: w?.name ?? '',
          workerPhone: w?.phoneE164 ?? '',
          lastMessageAt: c.lastMessageAt,
          messageCount: s.messages.filter((m) => m.conversationId === c.id).length,
        };
      });
  }
  if (seg[1] === 'conversations' && seg[2] && seg[3] === 'messages') {
    return s.messages
      .filter((m) => m.conversationId === seg[2])
      .sort((a, b) => ts(a.createdAt) - ts(b.createdAt))
      .map(rewriteAudio);
  }
  if (route === 'GET /api/escalations') {
    return [...s.escalations]
      .filter((e) => !query.status || e.status === query.status)
      .sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
      .map((e) => ({ ...e, workerName: s.workers.find((w) => w.id === e.workerId)?.name ?? '' }));
  }
  if (seg[1] === 'escalations' && seg[2] && seg[3] === 'resolve') {
    const esc = s.escalations.find((e) => e.id === seg[2]) ?? fail(404, 'Escalation not found');
    esc.status = 'resolved';
    esc.updatedAt = nowIso();
    return esc;
  }

  // ── audit exports (CSV built in-browser; PDFs need the real backend) ──
  if (route === 'GET /api/audit/exports') return s.exports;
  if (route === 'POST /api/audit/exports') {
    const start = new Date(`${body.periodStart}T00:00:00Z`);
    const end = new Date(`${body.periodEnd}T23:59:59.999Z`);
    const inRange = s.events.filter((e) => ts(e.occurredAt) >= start.getTime() && ts(e.occurredAt) <= end.getTime());
    const esc = (v: unknown) => {
      const str = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const docTitle = new Map(s.documents.map((d) => [d.id, d.title]));
    const lines = [
      'event_id,occurred_at_utc,employee,phone,event_type,topic,farm_topic,confidence,question,answer,source_document,consent_status,consent_date_utc,cow_care_agreement,supervisor_sign_off',
      ...inRange.map((e) => {
        const w = s.workers.find((w) => w.id === e.workerId);
        const sig = w ? latestSignature(w.id) : null;
        const signOffs = w
          ? s.enrollments
              .filter((en) => en.workerId === w.id && en.status === 'completed')
              .map((en) => {
                const trackName = s.tracks.find((t) => t.id === en.trackId)?.name ?? '';
                return en.signedOffAt
                  ? `${trackName}: confirmed by ${en.signedOffName ?? ''} (${en.signedOffRole ?? ''}) ${String(en.signedOffAt).slice(0, 10)}`
                  : `${trackName}: completed, unconfirmed`;
              })
              .join('; ')
          : '';
        return [
          e.id, e.occurredAt, w?.name ?? '', w?.phoneE164 ?? '', e.eventType, e.topic,
          e.farmTopic ?? 'none',
          e.confidence ?? '', e.questionText ?? '', e.answerText ?? '',
          e.sourceDocumentId ? (docTitle.get(e.sourceDocumentId) ?? '') : '',
          w?.consentStatus ?? '', w?.consentedAt ?? '',
          sig ? `signed v${sig.agreementVersion} ${String(sig.signedAt).slice(0, 10)} via ${sig.method}` : 'unsigned',
          signOffs,
        ].map(esc).join(',');
      }),
    ];
    let csvUrl: string | null = null;
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
      try {
        csvUrl = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
      } catch {
        csvUrl = null;
      }
    }
    const row = {
      id: uuid(),
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      status: 'ready',
      errorText: null,
      createdAt: nowIso(),
      csvUrl,
      letterUrl: null, // PDF letter + transcripts zip are server features
      downloadUrl: null,
      eventCount: inRange.length,
    };
    s.exports.unshift(row);
    return row;
  }

  // ── settings / billing / admin ──
  if (route === 'PATCH /api/org') {
    Object.assign(s.org, body);
    return s.org;
  }
  if (route === 'GET /api/billing/status') return { enabled: false, billing: { active: false } };
  if (route === 'POST /api/admin/run-drip') return runDrip();

  // ── simulator ──
  if (route === 'GET /api/simulator/workers') {
    return s.workers
      .filter((w) => w.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((w) => ({
        id: w.id,
        name: w.name,
        phoneE164: w.phoneE164,
        lastInboundAt: w.lastInboundAt,
        consentStatus: w.consentStatus ?? 'opted_in',
        pendingAgreement: !!(w.pendingAgreementId && w.pendingAgreementSentAt),
      }));
  }
  if (route === 'POST /api/simulator/inbound') {
    handleInbound(body.workerId, body.kind, String(body.text ?? '').trim());
    return { ok: true };
  }
  if (seg[1] === 'simulator' && seg[2] === 'conversation' && seg[3]) {
    const worker = s.workers.find((w) => w.id === seg[3]) ?? fail(404, 'Worker not found');
    const conv = s.conversations.find((c) => c.workerId === worker.id);
    const msgs = conv
      ? s.messages
          .filter((m) => m.conversationId === conv.id)
          .sort((a, b) => ts(a.createdAt) - ts(b.createdAt))
          .map(rewriteAudio)
      : [];
    return { workerId: worker.id, lastInboundAt: worker.lastInboundAt, messages: msgs };
  }
  if (route === 'POST /api/simulator/run-drip') return runDrip();
  if (route === 'POST /api/simulator/close-window') {
    const worker = s.workers.find((w) => w.id === body.workerId) ?? fail(404, 'Worker not found');
    worker.lastInboundAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    return { ok: true, lastInboundAt: worker.lastInboundAt };
  }

  fail(404, `Demo API: no handler for ${route}`);
}

/** Test hook: reset all in-memory demo state. */
export function resetDemoStore(): void {
  store = undefined;
}
