import fs from 'node:fs';
import path from 'node:path';
import { and, isNotNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { messages, trainingEvents } from '../db/schema.js';
import { config } from '../config.js';
import { storageRoot } from '../lib/storage.js';
import { publicMediaAbsPath } from './speech.js';

/**
 * Raw-content retention (RAW_CONTENT_RETENTION_DAYS, default 180): a nightly
 * job nulls message bodies, voice transcripts, media references and
 * training-event question/answer text older than the cutoff, and deletes the
 * audio files behind them. The derived training-documentation fields (topic,
 * farm_topic, confidence, source_chunk_ids, event_type, occurred_at) are the
 * compliance record the product exists to produce — they are NEVER touched.
 * Idempotent: a second run over the same rows matches nothing.
 */

export interface RetentionResult {
  messagesRedacted: number;
  eventsRedacted: number;
  filesDeleted: number;
}

export function retentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - config().rawContentRetentionDays * 24 * 3600_000);
}

/** Delete the local file behind an audio_reply_url (public-media/<uuid>.<ext>). */
export async function deleteAudioReplyFile(audioReplyUrl: string): Promise<boolean> {
  const filename = audioReplyUrl.split('/').pop() ?? '';
  try {
    await fs.promises.unlink(publicMediaAbsPath(filename));
    return true;
  } catch {
    // Already gone or a malformed name — nulling the column is what matters.
    return false;
  }
}

export async function pruneRawContent(db: Db, now: Date = new Date()): Promise<RetentionResult> {
  const cutoff = retentionCutoff(now);
  let filesDeleted = 0;

  // 1. Outbound TTS voice files past retention, before their rows lose the URL.
  const oldAudio = await db
    .select({ audioReplyUrl: messages.audioReplyUrl })
    .from(messages)
    .where(and(lt(messages.createdAt, cutoff), isNotNull(messages.audioReplyUrl)));
  for (const row of oldAudio) {
    if (await deleteAudioReplyFile(row.audioReplyUrl!)) filesDeleted++;
  }

  // 2. Null raw content on old messages. Inbound media_url values point at
  //    Twilio-hosted media (never local files), so there is nothing to unlink
  //    for them; the raw voice notes we DO store locally are swept in (4).
  const redactedMessages = await db
    .update(messages)
    .set({
      bodyText: null,
      transcriptText: null,
      mediaUrl: null,
      audioReplyUrl: null,
      updatedAt: now,
    })
    .where(
      and(
        lt(messages.createdAt, cutoff),
        or(
          isNotNull(messages.bodyText),
          isNotNull(messages.transcriptText),
          isNotNull(messages.mediaUrl),
          isNotNull(messages.audioReplyUrl),
        ),
      ),
    )
    .returning({ id: messages.id });

  // 3. Old training events lose their raw text only.
  const redactedEvents = await db
    .update(trainingEvents)
    .set({ questionText: null, answerText: null, updatedAt: now })
    .where(
      and(
        lt(trainingEvents.occurredAt, cutoff),
        or(isNotNull(trainingEvents.questionText), isNotNull(trainingEvents.answerText)),
      ),
    )
    .returning({ id: trainingEvents.id });

  // 4. Raw inbound voice notes ({orgId}/voice-in/*) are stored under random
  //    names no row references — sweep them by file mtime.
  try {
    const root = storageRoot();
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name, 'voice-in');
      let files: string[] = [];
      try {
        files = await fs.promises.readdir(dir);
      } catch {
        continue; // org has no voice-in dir
      }
      for (const f of files) {
        const p = path.join(dir, f);
        try {
          const st = await fs.promises.stat(p);
          if (st.isFile() && st.mtime < cutoff) {
            await fs.promises.unlink(p);
            filesDeleted++;
          }
        } catch {
          // raced/removed — fine
        }
      }
    }
  } catch {
    // storage root may not exist yet in a fresh environment
  }

  return {
    messagesRedacted: redactedMessages.length,
    eventsRedacted: redactedEvents.length,
    filesDeleted,
  };
}
