/**
 * WhatsApp 24-hour customer-service window (Meta policy):
 * free-form messages are only allowed within 24h of the worker's last
 * inbound message; outside that window only pre-approved templates may be
 * sent. Every outbound path goes through sendToWorker, which consults this.
 */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export type WindowState = 'open' | 'closed';

export function windowState(
  lastInboundAt: Date | null | undefined,
  now: Date = new Date(),
): WindowState {
  if (!lastInboundAt) return 'closed';
  const age = now.getTime() - lastInboundAt.getTime();
  return age >= 0 && age < WINDOW_MS ? 'open' : 'closed';
}
