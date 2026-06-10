import { describe, expect, it } from 'vitest';
import { ensureCitation, parseMetaTag } from '../../src/server/services/answer.js';
import { splitMessage } from '../../src/server/services/sendToWorker.js';
import type { RetrievedChunk } from '../../src/server/services/retrieval.js';

const CHUNK: RetrievedChunk = {
  id: 'c1',
  documentId: 'd1',
  documentTitle: 'Rutina de ordeño',
  headingPath: 'Rutina de ordeño > Pre-dip',
  content: 'Deja el pre-dip 30 segundos.',
  similarity: 0.9,
};

describe('parseMetaTag', () => {
  it('parses and strips the meta tag', () => {
    const raw = 'El pre-dip se deja 30 segundos.\n\n<meta confidence="grounded" topic="Ordeño"/>';
    const parsed = parseMetaTag(raw);
    expect(parsed.confidence).toBe('grounded');
    expect(parsed.topic).toBe('Ordeño');
    expect(parsed.text).toBe('El pre-dip se deja 30 segundos.');
    expect(parsed.text).not.toContain('<meta');
  });

  it('handles not_found and missing tags', () => {
    expect(parseMetaTag('x <meta confidence="not_found" topic="Otro"/>').confidence).toBe(
      'not_found',
    );
    const missing = parseMetaTag('Respuesta sin etiqueta.');
    expect(missing.confidence).toBeNull();
    expect(missing.text).toBe('Respuesta sin etiqueta.');
  });
});

describe('ensureCitation', () => {
  it('appends the citation when the model forgot it', () => {
    const out = ensureCitation('Deja el pre-dip 30 segundos.', CHUNK);
    expect(out).toContain('📄 Fuente: Rutina de ordeño — Rutina de ordeño > Pre-dip');
  });

  it('does not duplicate an existing citation', () => {
    const withCite = 'Texto.\n\n📄 Fuente: Rutina de ordeño — Pre-dip';
    expect(ensureCitation(withCite, CHUNK)).toBe(withCite);
  });
});

describe('splitMessage (WhatsApp 1200-char segments)', () => {
  it('passes short messages through untouched', () => {
    expect(splitMessage('hola')).toEqual(['hola']);
  });

  it('splits long text on paragraph boundaries, preserving all content', () => {
    const para = 'Una instrucción del procedimiento que es razonablemente larga. '.repeat(8);
    const text = Array.from({ length: 6 }, () => para.trim()).join('\n\n');
    const segments = splitMessage(text);
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) expect(s.length).toBeLessThanOrEqual(1200);
    const rejoined = segments.join(' ').replace(/\s+/g, ' ');
    expect(rejoined).toContain('Una instrucción del procedimiento');
    expect(rejoined.length).toBeGreaterThanOrEqual(text.replace(/\s+/g, ' ').length - 10);
  });
});
