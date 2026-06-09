import { DateTime } from 'luxon';

/**
 * Compute when a module should be delivered: `dayOffset` days after the
 * enrollment date (in the org's timezone), at `sendHourLocal` o'clock local.
 * Times already in the past resolve to "now" so day-0 modules go out
 * immediately after enrollment.
 */
export function computeScheduledFor(
  enrolledAt: Date,
  dayOffset: number,
  sendHourLocal: number,
  timezone: string,
  now: Date = new Date(),
): Date {
  const local = DateTime.fromJSDate(enrolledAt, { zone: timezone })
    .startOf('day')
    .plus({ days: dayOffset })
    .set({ hour: sendHourLocal, minute: 0, second: 0, millisecond: 0 });
  const utc = local.toUTC().toJSDate();
  return utc.getTime() < now.getTime() ? now : utc;
}

export function formatDateEs(d: Date, timezone: string): string {
  return DateTime.fromJSDate(d, { zone: timezone }).setLocale('es').toFormat('d LLLL yyyy');
}

export function formatDateTimeEn(d: Date, timezone: string): string {
  return DateTime.fromJSDate(d, { zone: timezone }).toFormat('LLL d, yyyy h:mm a');
}

export function formatDateEn(d: Date, timezone: string): string {
  return DateTime.fromJSDate(d, { zone: timezone }).toFormat('LLL d, yyyy');
}
