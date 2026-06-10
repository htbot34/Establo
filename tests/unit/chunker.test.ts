import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../../src/server/services/chunker.js';
import { estimateTokens } from '../../src/server/lib/tokens.js';

const SOP = `# Rutina de ordeño

Intro corta del documento.

## Pre-dip

1. Aplica el pre-dip cubriendo 3/4 del pezón.
2. Deja actuar 30 segundos.

## Despunte

Saca 3 a 4 chorros por cuarto.

### Qué observar

Grumos, sangre o agua.
`;

describe('chunkMarkdown', () => {
  it('splits on headings and records full heading paths', () => {
    const chunks = chunkMarkdown(SOP, 'Fallback');
    const paths = chunks.map((c) => c.headingPath);
    expect(paths).toContain('Rutina de ordeño');
    expect(paths).toContain('Rutina de ordeño > Pre-dip');
    expect(paths).toContain('Rutina de ordeño > Despunte > Qué observar');
  });

  it('keeps section content intact', () => {
    const chunks = chunkMarkdown(SOP, 'Fallback');
    const predip = chunks.find((c) => c.headingPath.endsWith('Pre-dip'))!;
    expect(predip.content).toContain('30 segundos');
    expect(predip.content).toContain('3/4 del pezón');
  });

  it('uses the fallback title when there are no headings', () => {
    const chunks = chunkMarkdown('Texto plano sin encabezados. Otra frase.', 'Mi Documento');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('Mi Documento');
  });

  it('skips empty sections', () => {
    const chunks = chunkMarkdown('# Título\n\n## Vacía\n\n## Llena\n\ncontenido', 'F');
    expect(chunks.every((c) => c.content.trim().length > 0)).toBe(true);
  });

  it('splits oversized sections to ≤ maxTokens with overlap between parts', () => {
    const sentences = Array.from(
      { length: 120 },
      (_, i) => `La oración número ${i} habla del procedimiento de lavado con bastante detalle adicional.`,
    ).join(' ');
    const md = `# Doc\n\n## Sección Grande\n\n${sentences}`;
    const opts = { targetTokens: 200, maxTokens: 260, overlapTokens: 40 };
    const chunks = chunkMarkdown(md, 'F', opts).filter((c) =>
      c.headingPath.includes('Sección Grande'),
    );
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(estimateTokens(c.content)).toBeLessThanOrEqual(opts.maxTokens + opts.overlapTokens);
    }
    // Overlap: each chunk after the first starts with text from the previous one.
    for (let i = 1; i < chunks.length; i++) {
      const firstLine = chunks[i].content.split('\n')[0];
      expect(chunks[i - 1].content).toContain(firstLine);
    }
  });
});
