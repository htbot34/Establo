import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orgs } from '../db/schema.js';

/**
 * WhatsApp template delivery health. Meta can recategorize a submitted
 * utility template as marketing, and marketing templates to +1 (US) numbers
 * have been paused since April 2025 — so a silent recategorization kills US
 * delivery with nothing but status-callback failures to show for it.
 *
 * The Twilio status webhook posts ErrorCode on failed/undelivered messages.
 * We key off error CODES (never message strings) that indicate
 * template/category-policy problems, and pause ALL template sends for the org
 * until an owner acknowledges — retrying a category-blocked template would
 * just burn quality rating.
 */

interface KnownError {
  code: string;
  description: string;
}

// Twilio codes (63xxx) and the Meta/WhatsApp codes (13xxxx) Twilio passes
// through. Curated to the template/category-policy class; extend as observed.
const TEMPLATE_POLICY_ERRORS: KnownError[] = [
  { code: '63013', description: 'Meta policy violation — message rejected by WhatsApp' },
  { code: '63016', description: 'Free-form message outside the 24h window — approved template required' },
  { code: '63049', description: 'Meta blocked delivery (marketing message block, 131049-class)' },
  { code: '131049', description: 'Meta: not delivered to maintain healthy ecosystem engagement (US marketing pause / frequency cap)' },
  { code: '131050', description: 'Meta: recipient has stopped marketing messages' },
  { code: '132001', description: 'Meta: template does not exist or is not approved for this language' },
  { code: '132015', description: 'Meta: template is paused due to low quality' },
  { code: '132016', description: 'Meta: template is disabled' },
];

const byCode = new Map(TEMPLATE_POLICY_ERRORS.map((e) => [e.code, e]));

export function isTemplatePolicyError(errorCode: string | undefined | null): boolean {
  return !!errorCode && byCode.has(String(errorCode).trim());
}

export function describeTemplateError(errorCode: string): string {
  const known = byCode.get(String(errorCode).trim());
  return known ? `Error ${known.code}: ${known.description}` : `Error ${errorCode}`;
}

/** Pause all template sends for the org until an owner acknowledges. */
export async function pauseTemplateSends(
  db: Db,
  orgId: string,
  errorCode: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(orgs)
    .set({
      templateSendsPausedAt: now,
      templatePauseReason: describeTemplateError(errorCode),
      updatedAt: now,
    })
    .where(eq(orgs.id, orgId));
  console.error(
    `⚠️  Template sends PAUSED for org ${orgId} — ${describeTemplateError(errorCode)}. ` +
      'An owner must acknowledge in the dashboard before template sends resume.',
  );
}

/** Owner acknowledged the alert (after fixing/resubmitting the template). */
export async function resumeTemplateSends(db: Db, orgId: string): Promise<void> {
  await db
    .update(orgs)
    .set({ templateSendsPausedAt: null, templatePauseReason: null, updatedAt: new Date() })
    .where(eq(orgs.id, orgId));
}

export async function templateSendsPaused(db: Db, orgId: string): Promise<boolean> {
  const [org] = await db
    .select({ pausedAt: orgs.templateSendsPausedAt })
    .from(orgs)
    .where(eq(orgs.id, orgId));
  return !!org?.pausedAt;
}
