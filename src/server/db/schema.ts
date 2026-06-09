import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const orgs = pgTable('orgs', {
  id: id(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('America/Boise'),
  locale: text('locale').notNull().default('es'),
  herdSize: integer('herd_size'),
  settings: jsonb('settings').notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['owner', 'manager'] }).notNull().default('manager'),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), index('users_org_idx').on(t.orgId)],
);

export const workers = pgTable(
  'workers',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    preferredLanguage: text('preferred_language').notNull().default('es'),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    hiredAt: timestamp('hired_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('workers_phone_uq').on(t.phoneE164), index('workers_org_idx').on(t.orgId)],
);

export const sopDocuments = pgTable(
  'sop_documents',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    originalFilename: text('original_filename'),
    mimeType: text('mime_type'),
    storagePath: text('storage_path'),
    status: text('status', { enum: ['uploaded', 'processing', 'ready', 'failed'] })
      .notNull()
      .default('uploaded'),
    language: text('language').notNull().default('es'),
    pageCount: integer('page_count'),
    errorText: text('error_text'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sop_documents_org_idx').on(t.orgId)],
);

export const sopChunks = pgTable(
  'sop_chunks',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => sopDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    headingPath: text('heading_path').notNull().default(''),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sop_chunks_org_idx').on(t.orgId),
    index('sop_chunks_document_idx').on(t.documentId),
  ],
);

export const onboardingTracks = pgTable(
  'onboarding_tracks',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('onboarding_tracks_org_idx').on(t.orgId)],
);

export const modules = pgTable(
  'modules',
  {
    id: id(),
    trackId: uuid('track_id')
      .notNull()
      .references(() => onboardingTracks.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    dayOffset: integer('day_offset').notNull().default(0),
    sendHourLocal: integer('send_hour_local').notNull().default(7),
    title: text('title').notNull(),
    bodyEs: text('body_es').notNull(),
    checkQuestionEs: text('check_question_es').notNull(),
    checkOptionsEs: jsonb('check_options_es').$type<string[]>().notNull(),
    checkCorrectIndex: integer('check_correct_index').notNull(),
    sourceDocumentId: uuid('source_document_id').references(() => sopDocuments.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('modules_track_idx').on(t.trackId), index('modules_org_idx').on(t.orgId)],
);

export const enrollments = pgTable(
  'enrollments',
  {
    id: id(),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    trackId: uuid('track_id')
      .notNull()
      .references(() => onboardingTracks.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status', { enum: ['active', 'completed', 'paused'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('enrollments_worker_idx').on(t.workerId),
    index('enrollments_org_idx').on(t.orgId),
  ],
);

export const moduleDeliveries = pgTable(
  'module_deliveries',
  {
    id: id(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    // pending → (notified, if outside the 24h window) → sent → answered
    status: text('status', { enum: ['pending', 'notified', 'sent', 'answered'] })
      .notNull()
      .default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    channelMessageSid: text('channel_message_sid'),
    checkAnsweredAt: timestamp('check_answered_at', { withTimezone: true }),
    checkAnswerIndex: integer('check_answer_index'),
    checkPassed: boolean('check_passed'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('module_deliveries_enrollment_idx').on(t.enrollmentId),
    index('module_deliveries_due_idx').on(t.orgId, t.status, t.scheduledFor),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('conversations_worker_idx').on(t.workerId),
    index('conversations_org_idx').on(t.orgId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    type: text('type', { enum: ['text', 'voice', 'image', 'template'] }).notNull(),
    bodyText: text('body_text'),
    transcriptText: text('transcript_text'),
    mediaUrl: text('media_url'),
    audioReplyUrl: text('audio_reply_url'),
    twilioSid: text('twilio_sid'),
    status: text('status').notNull().default('received'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    index('messages_org_idx').on(t.orgId),
  ],
);

export const TRAINING_EVENT_TYPES = [
  'qa_interaction',
  'module_delivered',
  'check_passed',
  'check_failed',
  'escalation',
] as const;
export type TrainingEventType = (typeof TRAINING_EVENT_TYPES)[number];

export const trainingEvents = pgTable(
  'training_events',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    eventType: text('event_type', { enum: TRAINING_EVENT_TYPES }).notNull(),
    topic: text('topic').notNull().default('Otro'),
    questionText: text('question_text'),
    answerText: text('answer_text'),
    sourceDocumentId: uuid('source_document_id').references(() => sopDocuments.id, {
      onDelete: 'set null',
    }),
    sourceChunkIds: jsonb('source_chunk_ids').$type<string[]>(),
    confidence: text('confidence', { enum: ['grounded', 'partial', 'not_found'] }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('training_events_org_time_idx').on(t.orgId, t.occurredAt),
    index('training_events_worker_idx').on(t.workerId, t.occurredAt),
  ],
);

export const escalations = pgTable(
  'escalations',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    questionText: text('question_text').notNull(),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['open', 'resolved'] }).notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('escalations_org_idx').on(t.orgId, t.status)],
);

export const auditExports = pgTable(
  'audit_exports',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    status: text('status', { enum: ['pending', 'processing', 'ready', 'failed'] })
      .notNull()
      .default('pending'),
    filePath: text('file_path'),
    errorText: text('error_text'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('audit_exports_org_idx').on(t.orgId)],
);

export const webhookLogs = pgTable('webhook_logs', {
  id: id(),
  payload: jsonb('payload').notNull(),
  signatureValid: boolean('signature_valid'),
  processed: boolean('processed').notNull().default(false),
  errorText: text('error_text'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Org = typeof orgs.$inferSelect;
export type User = typeof users.$inferSelect;
export type Worker = typeof workers.$inferSelect;
export type SopDocument = typeof sopDocuments.$inferSelect;
export type SopChunk = typeof sopChunks.$inferSelect;
export type OnboardingTrack = typeof onboardingTracks.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type Enrollment = typeof enrollments.$inferSelect;
export type ModuleDelivery = typeof moduleDeliveries.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type TrainingEvent = typeof trainingEvents.$inferSelect;
export type Escalation = typeof escalations.$inferSelect;
export type AuditExport = typeof auditExports.$inferSelect;
