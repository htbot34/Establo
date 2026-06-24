import { describe, expect, it } from 'vitest';
import {
  VIDEO_CATALOG,
  getCuratedVideo,
  verifyCatalog,
} from '../../src/server/services/videoCatalog.js';
import { WORKER_ROLES } from '../../src/server/services/roles.js';
import { FARM_TOPICS } from '../../src/server/db/schema.js';
import { parseVideoUrl } from '../../src/server/services/video.js';

describe('curated video catalog', () => {
  it('verifyCatalog passes with the shipped data', () => {
    const { ok, problems } = verifyCatalog();
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
  });

  it('is non-empty and every key is unique', () => {
    expect(VIDEO_CATALOG.length).toBeGreaterThan(0);
    const keys = VIDEO_CATALOG.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  const roleSet = new Set<string>(WORKER_ROLES);
  const topicSet = new Set<string>(FARM_TOPICS);
  for (const v of VIDEO_CATALOG) {
    describe(v.key, () => {
      it('carries a non-empty required attribution', () => {
        expect(v.attribution.trim().length).toBeGreaterThan(0);
      });
      it('targets only known worker roles (⊆ WORKER_ROLES)', () => {
        for (const r of v.suggestedRoles) expect(roleSet.has(r)).toBe(true);
      });
      it('uses a valid FARM topic', () => {
        expect(topicSet.has(v.suggestedFarmTopic)).toBe(true);
      });
      it('lists at least one language', () => {
        expect(v.langs.length).toBeGreaterThan(0);
      });
      it('resolves to an embeddable YouTube video', () => {
        const parsed = parseVideoUrl(v.url);
        expect(parsed?.provider).toBe('youtube');
        expect(parsed?.embedUrl).toMatch(/youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}$/);
        expect(parsed?.provider).toBe(v.provider);
      });
      it('round-trips through getCuratedVideo', () => {
        expect(getCuratedVideo(v.key)).toBe(v);
      });
    });
  }

  it('getCuratedVideo returns undefined for an unknown key', () => {
    expect(getCuratedVideo('does_not_exist')).toBeUndefined();
  });

  it('shares one verbatim attribution across the CHAS series', () => {
    const attrs = new Set(VIDEO_CATALOG.map((v) => v.attribution));
    expect(attrs.size).toBe(1);
    expect([...attrs][0]).toContain('Considering Human and Animal Safety');
    expect([...attrs][0]).toContain('Usado con autorización');
  });

  it('exposes the keys the seed wires up', () => {
    const keys = VIDEO_CATALOG.map((v) => v.key);
    expect(keys).toContain('chas_outside_animal_care'); // universal video module
    expect(keys).toContain('chas_milking_barn'); // ordeño-targeted
    expect(keys).toContain('chas_milker_calf'); // becerras-targeted
  });
});
