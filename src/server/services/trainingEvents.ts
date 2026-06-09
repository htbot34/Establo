import type { Db } from '../db/client.js';
import { trainingEvents, type TrainingEventType } from '../db/schema.js';

export interface LogEventInput {
  orgId: string;
  workerId: string;
  eventType: TrainingEventType;
  topic: string;
  occurredAt?: Date;
  questionText?: string | null;
  answerText?: string | null;
  sourceDocumentId?: string | null;
  sourceChunkIds?: string[] | null;
  confidence?: 'grounded' | 'partial' | 'not_found' | null;
}

/** Every interaction becomes a training_event — this is the compliance record. */
export async function logTrainingEvent(db: Db, input: LogEventInput): Promise<void> {
  await db.insert(trainingEvents).values({
    orgId: input.orgId,
    workerId: input.workerId,
    eventType: input.eventType,
    topic: input.topic,
    occurredAt: input.occurredAt ?? new Date(),
    questionText: input.questionText ?? null,
    answerText: input.answerText ?? null,
    sourceDocumentId: input.sourceDocumentId ?? null,
    sourceChunkIds: input.sourceChunkIds ?? null,
    confidence: input.confidence ?? null,
  });
}
