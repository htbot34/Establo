export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Static GitHub Pages build: all API calls served by the in-browser mock. */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)establo_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (IS_DEMO) {
    const { demoFetch } = await import('./demo/demoApi');
    return demoFetch(path, opts) as Promise<T>;
  }
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.location.href = '/app/login';
    throw new ApiError('Not authenticated', 401);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export interface Me {
  user: { id: string; email: string; name: string; role: string };
  org: { id: string; name: string; timezone: string; herdSize: number | null; locale: string };
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
