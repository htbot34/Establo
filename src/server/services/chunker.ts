import { estimateTokens } from '../lib/tokens.js';

export interface Chunk {
  headingPath: string;
  content: string;
  tokenCount: number;
}

export interface ChunkOptions {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetTokens: 500,
  maxTokens: 600,
  overlapTokens: 50,
};

interface Section {
  headingPath: string;
  text: string;
}

/** Split normalized markdown into heading-scoped sections. */
function splitSections(markdown: string, fallbackTitle: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      const headingPath =
        stack.length > 0 ? stack.map((h) => h.title).join(' > ') : fallbackTitle;
      sections.push({ headingPath, text });
    }
    buffer = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: m[2].trim() });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function splitSentences(text: string): string[] {
  // Keep numbered-list lines intact; split prose on sentence boundaries.
  const parts: string[] = [];
  for (const block of text.split(/\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^(\d+[.)]|[-*•])\s/.test(trimmed)) {
      parts.push(trimmed);
    } else {
      for (const s of trimmed.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9])/)) {
        if (s.trim()) parts.push(s.trim());
      }
    }
  }
  return parts;
}

/**
 * Heading-aware chunker: split on headings first, then split long sections
 * into ~targetTokens chunks with ~overlapTokens of trailing-sentence overlap.
 * Every chunk keeps its heading_path so citations read naturally
 * ("Rutina de ordeño > Pre-dip").
 */
export function chunkMarkdown(
  markdown: string,
  fallbackTitle: string,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of splitSections(markdown, fallbackTitle)) {
    const sectionTokens = estimateTokens(section.text);
    if (sectionTokens <= opts.maxTokens) {
      chunks.push({
        headingPath: section.headingPath,
        content: section.text,
        tokenCount: sectionTokens,
      });
      continue;
    }
    const sentences = splitSentences(section.text);
    let current: string[] = [];
    let currentTokens = 0;
    const emit = () => {
      if (current.length === 0) return;
      const content = current.join('\n');
      chunks.push({
        headingPath: section.headingPath,
        content,
        tokenCount: estimateTokens(content),
      });
      // Carry trailing sentences (~overlapTokens) into the next chunk.
      const overlap: string[] = [];
      let overlapTokens = 0;
      for (let i = current.length - 1; i >= 0 && overlapTokens < opts.overlapTokens; i--) {
        overlap.unshift(current[i]);
        overlapTokens += estimateTokens(current[i]);
      }
      current = overlap;
      currentTokens = overlapTokens;
    };
    for (const sentence of sentences) {
      const t = estimateTokens(sentence);
      if (currentTokens + t > opts.targetTokens && current.length > 0) emit();
      current.push(sentence);
      currentTokens += t;
    }
    if (current.length > 0) {
      const content = current.join('\n');
      chunks.push({
        headingPath: section.headingPath,
        content,
        tokenCount: estimateTokens(content),
      });
    }
  }
  return chunks;
}
