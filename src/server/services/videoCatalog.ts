/**
 * Curated, content-agnostic training-video catalog (shared, pure — the static
 * demo AND the manager web UI import this directly, so it stays free of DB/node
 * imports, same discipline as services/video.ts and services/roles.ts).
 *
 * The universal onboarding layer (animal-handling/safety principles that don't
 * vary farm to farm) is delivered as professional bilingual video. This catalog
 * holds Robert Hagevoort's "Considering Human and Animal Safety" series, a free
 * bilingual extension series distributed via youtube.com/USagCenters and
 * NYCAMH/HICAHS. The rights holder's one condition for reuse was proper
 * acknowledgment, so every entry carries a REQUIRED Spanish attribution credit
 * (`attribution`) that is surfaced to the worker and kept on the training
 * record — it is a hard requirement, not a nicety.
 *
 * Establo NEVER hosts, uploads, downloads, or clips video — `url` is a public
 * LINK we send/embed. The worker side is Spanish-only, so each entry's `url` is
 * the Spanish video; `urlEn` is the English equivalent kept for the manager's
 * reference only (never delivered to a worker).
 */
import { FARM_TOPICS, type FarmTopic } from '../db/schema.js';
import { WORKER_ROLES } from './roles.js';
import { parseVideoUrl, type VideoProvider } from './video.js';

export interface CuratedVideo {
  /** Stable slug, e.g. 'chas_milking_barn'. */
  key: string;
  /** Spanish watch URL (worker-facing — this is what gets delivered). */
  url: string;
  /** English equivalent (manager reference only; never sent to a worker). */
  urlEn?: string;
  /** Spanish title shown to the worker. */
  titleEs: string;
  /** Derived from `url` via parseVideoUrl (youtube|vimeo|url). */
  provider: VideoProvider;
  /** Available languages, e.g. ['es','en']. */
  langs: string[];
  /** REQUIRED source-credit line (Spanish). Shown to the worker + on the record. */
  attribution: string;
  /** Suggested role targeting: [] = universal; else a subset of WORKER_ROLES. */
  suggestedRoles: string[];
  /** Suggested FARM Animal Care v5 CE area (a manager can override per module). */
  suggestedFarmTopic: FarmTopic;
  /** Source series this video belongs to. */
  series: 'CHAS';
}

/**
 * The proper acknowledgment the rights holder asked for, verbatim. Used for
 * every entry in the series (a manager may later confirm exact on-card wording).
 */
const CHAS_ATTRIBUTION =
  '«Considering Human and Animal Safety» — producido bajo la dirección del ' +
  'Dr. Robert Hagevoort (NMSU Cooperative Extension), por el High Plains ' +
  'Intermountain Center for Agricultural Health and Safety (HICAHS) y el ' +
  'Southern Great Plains Dairy Consortium. Usado con autorización.';

/** Catalog rows without `provider` (derived below from `url`). */
type RawCuratedVideo = Omit<CuratedVideo, 'provider' | 'attribution' | 'series'>;

// "Considering Human and Animal Safety" (key prefix `chas_`). Real, verified
// YouTube URLs sourced from NYCAMH/HICAHS (an authorized distributor). `url` is
// the Spanish (worker-facing) link; `urlEn` is the English reference link.
const CHAS_RAW: RawCuratedVideo[] = [
  {
    key: 'chas_intro',
    titleEs: 'Introducción a la seguridad en la lechería',
    url: 'https://youtu.be/C6GE15_rRxw',
    urlEn: 'https://youtu.be/CcJuf7wNu0o',
    langs: ['es', 'en'],
    suggestedRoles: [], // universal
    suggestedFarmTopic: 'none',
  },
  {
    key: 'chas_outside_animal_care',
    titleEs: 'Cuidado de animales en exteriores',
    url: 'https://youtu.be/yj5hJ3zslIQ',
    urlEn: 'https://youtu.be/oZdiYKe4Qpo',
    langs: ['es', 'en'],
    suggestedRoles: [], // universal
    suggestedFarmTopic: 'stockmanship_general',
  },
  {
    key: 'chas_milking_barn',
    titleEs: 'Seguridad en la sala de ordeño',
    url: 'https://youtu.be/5n61W1RPdtA',
    urlEn: 'https://youtu.be/wyrwkMalUS8',
    langs: ['es', 'en'],
    suggestedRoles: ['ordeno'],
    suggestedFarmTopic: 'stockmanship_general',
  },
  {
    key: 'chas_feeding_other',
    titleEs: 'Alimentación y otros riesgos de seguridad',
    url: 'https://youtu.be/CSb1ZCDKje0',
    urlEn: 'https://youtu.be/xXCbJtMeFxo',
    langs: ['es', 'en'],
    suggestedRoles: ['alimentacion'],
    // safety_other intentionally does NOT count toward FARM Animal Care CE —
    // feeding safety isn't an animal-care CE area. This is correct, not a bug.
    suggestedFarmTopic: 'safety_other',
  },
  {
    key: 'chas_general_outside',
    titleEs: 'Seguridad general y de trabajadores de exterior',
    url: 'https://youtu.be/ly7x6HKGHNE',
    urlEn: 'https://youtu.be/x8MmZv8v4Dw',
    langs: ['es', 'en'],
    suggestedRoles: [], // universal
    suggestedFarmTopic: 'stockmanship_general',
  },
  {
    key: 'chas_milker_calf',
    titleEs: 'Seguridad para ordeñadores y cuidado de becerras',
    url: 'https://youtu.be/pfX3GgvKAyY',
    urlEn: 'https://youtu.be/E1p-8dEk7CM',
    langs: ['es', 'en'],
    // A single video (Part II, Section 2) covering BOTH milkers and calf
    // caretakers, so it targets both roles; tagged preweaned_calf for CE
    // because that is its FARM-relevant content.
    suggestedRoles: ['ordeno', 'becerras'],
    suggestedFarmTopic: 'preweaned_calf',
  },
  {
    key: 'chas_feeder',
    titleEs: 'Seguridad para alimentadores',
    url: 'https://youtu.be/l8uwWgzTwFU',
    urlEn: 'https://youtu.be/uwG9T_5Yod4',
    langs: ['es', 'en'],
    suggestedRoles: ['alimentacion'],
    // safety_other — feeding safety is worker safety, not an animal-care CE area.
    suggestedFarmTopic: 'safety_other',
  },
];

const ROLE_SET = new Set<string>(WORKER_ROLES);
const TOPIC_SET = new Set<string>(FARM_TOPICS);

/** Derive the provider from a URL; throws on a non-video/non-https URL. */
function deriveProvider(key: string, url: string): VideoProvider {
  const parsed = parseVideoUrl(url);
  if (!parsed) throw new Error(`videoCatalog: ${key} has an invalid video URL: ${url}`);
  return parsed.provider;
}

function buildEntry(raw: RawCuratedVideo): CuratedVideo {
  // Fail fast on bad data at module load — a typo'd role or FARM topic should
  // never reach the dashboard picker or the seed.
  for (const r of raw.suggestedRoles) {
    if (!ROLE_SET.has(r)) throw new Error(`videoCatalog: ${raw.key} has unknown role "${r}"`);
  }
  if (!TOPIC_SET.has(raw.suggestedFarmTopic)) {
    throw new Error(`videoCatalog: ${raw.key} has unknown FARM topic "${raw.suggestedFarmTopic}"`);
  }
  return {
    ...raw,
    provider: deriveProvider(raw.key, raw.url),
    attribution: CHAS_ATTRIBUTION,
    series: 'CHAS',
  };
}

export const VIDEO_CATALOG: CuratedVideo[] = CHAS_RAW.map(buildEntry);

export function getCuratedVideo(key: string): CuratedVideo | undefined {
  return VIDEO_CATALOG.find((v) => v.key === key);
}

/**
 * Validate the whole catalog without throwing: each entry must have a non-empty
 * attribution, a valid embeddable YouTube/Vimeo `url` (and `urlEn` if present),
 * at least one language, roles ⊆ WORKER_ROLES, and a known FARM topic; keys must
 * be unique. Powers both `pnpm verify-video-catalog` and the unit test.
 */
export function verifyCatalog(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const v of VIDEO_CATALOG) {
    if (!v.key) problems.push('an entry is missing a key');
    if (seen.has(v.key)) problems.push(`duplicate key: ${v.key}`);
    seen.add(v.key);

    if (!v.titleEs.trim()) problems.push(`${v.key}: empty titleEs`);
    if (!v.attribution.trim()) problems.push(`${v.key}: empty attribution`);
    if (!v.langs || v.langs.length === 0) problems.push(`${v.key}: no languages`);

    const parsed = parseVideoUrl(v.url);
    if (!parsed) problems.push(`${v.key}: url is not a valid https video link`);
    else if (!parsed.embedUrl) problems.push(`${v.key}: url is not an embeddable YouTube/Vimeo link`);
    else if (parsed.provider !== v.provider) {
      problems.push(`${v.key}: provider "${v.provider}" disagrees with parsed "${parsed.provider}"`);
    }

    if (v.urlEn) {
      const en = parseVideoUrl(v.urlEn);
      if (!en) problems.push(`${v.key}: urlEn is not a valid https video link`);
      else if (!en.embedUrl) problems.push(`${v.key}: urlEn is not an embeddable YouTube/Vimeo link`);
    }

    for (const r of v.suggestedRoles) {
      if (!ROLE_SET.has(r)) problems.push(`${v.key}: unknown role "${r}"`);
    }
    if (!TOPIC_SET.has(v.suggestedFarmTopic)) {
      problems.push(`${v.key}: unknown FARM topic "${v.suggestedFarmTopic}"`);
    }
  }

  return { ok: problems.length === 0, problems };
}
