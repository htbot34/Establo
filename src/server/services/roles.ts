/**
 * Role-scoped onboarding (shared, pure — the static demo AND the manager web
 * UI import this directly, so it must stay free of DB/node imports to keep the
 * browser bundle lean; `db/schema.ts` consumes WORKER_ROLES from here for the
 * column enums).
 *
 * A worker has a job role; a module optionally targets a set of roles. When a
 * module's `applies_to_roles` is null/empty it is UNIVERSAL (every worker gets
 * it); otherwise only workers whose role is in the list receive it. This keeps
 * universal lessons in one place instead of duplicating them across
 * role-specific tracks — "milkers get milking lessons, not tractor lessons".
 */

export const WORKER_ROLES = [
  'ordeno',
  'becerras',
  'alimentacion',
  'salud_hato',
  'general',
] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

export const WORKER_ROLE_LABELS: Record<WorkerRole, string> = {
  ordeno: 'Milking (Ordeño)',
  becerras: 'Calf care (Becerras)',
  alimentacion: 'Feeding (Alimentación)',
  salud_hato: 'Herd health (Salud del hato)',
  general: 'General / all roles',
};

export function isValidWorkerRole(t: string): t is WorkerRole {
  return (WORKER_ROLES as readonly string[]).includes(t);
}

/**
 * True when a module targeting `appliesToRoles` should reach a worker whose job
 * role is `jobRole`. Universal (null/empty list) → always true. Otherwise the
 * worker's role must be listed; an unassigned (null) role only gets universals.
 */
export function roleApplies(
  appliesToRoles: string[] | null | undefined,
  jobRole: string | null | undefined,
): boolean {
  if (!appliesToRoles || appliesToRoles.length === 0) return true;
  return jobRole != null && appliesToRoles.includes(jobRole);
}
