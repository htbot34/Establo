/**
 * Optional per-module video — generic and content-agnostic (shared, pure; the
 * static demo and the manager web UI import it, so no DB/node deps).
 *
 * Establo NEVER hosts, uploads, downloads, or clips video. Production sends a
 * LINK (WhatsApp can't take YouTube uploads and has size limits; a link
 * unfurls). The dashboard renders an embedded PREVIEW for YouTube via the
 * privacy-enhanced youtube-nocookie domain, and for Vimeo via its player. Any
 * other https link is accepted as a plain link with no embed.
 *
 * Re-hosting or clipping someone else's video requires their written
 * permission; embedding/sending a public link is the supported pattern.
 */

export type VideoProvider = 'youtube' | 'vimeo' | 'url';

export interface ParsedVideo {
  provider: VideoProvider;
  /** Normalized https URL. */
  url: string;
  /** Provider video id when recognized (YouTube/Vimeo), else null. */
  videoId: string | null;
  /** Embeddable preview URL (youtube-nocookie / vimeo player), else null. */
  embedUrl: string | null;
}

function asHttpsUrl(input: string): URL | null {
  try {
    const u = new URL(input.trim());
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

const YT_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
]);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function youtubeId(u: URL, host: string): string | null {
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (!YT_HOSTS.has(host)) return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(?:embed|shorts|v)\/([^/]+)/);
  return m ? m[1] : null;
}

function vimeoId(u: URL, host: string): string | null {
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  const m = u.pathname.match(/(?:\/video)?\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Parse/normalize a video URL. Returns null for non-URLs, non-https, or junk.
 * YouTube watch / youtu.be / embed / shorts forms all resolve to the same id
 * and a youtube-nocookie embed URL; Vimeo resolves to its player embed.
 */
export function parseVideoUrl(input: string): ParsedVideo | null {
  if (!input || typeof input !== 'string') return null;
  const u = asHttpsUrl(input);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  const yt = youtubeId(u, host);
  if (yt && YT_ID.test(yt)) {
    return {
      provider: 'youtube',
      url: u.toString(),
      videoId: yt,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`,
    };
  }

  const vm = vimeoId(u, host);
  if (vm) {
    return {
      provider: 'vimeo',
      url: u.toString(),
      videoId: vm,
      embedUrl: `https://player.vimeo.com/video/${vm}`,
    };
  }

  // Any other https URL is a valid plain link (no embeddable preview).
  return { provider: 'url', url: u.toString(), videoId: null, embedUrl: null };
}

export function isValidVideoUrl(input: string): boolean {
  return parseVideoUrl(input) !== null;
}

/** Extract the first embeddable/linkable video from free text (a delivered
 *  module message), so the worker-facing UI can render a preview. */
export function videoFromText(text: string): ParsedVideo | null {
  const match = text.match(/https:\/\/\S+/);
  if (!match) return null;
  // Trim trailing punctuation that often follows a URL in prose.
  const cleaned = match[0].replace(/[)\].,;]+$/, '');
  return parseVideoUrl(cleaned);
}
