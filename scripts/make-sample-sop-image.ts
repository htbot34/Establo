/**
 * Generate samples/sop-photo-sample.png — a synthetic "photo of a printed
 * SOP page" used to test the OCR ingestion path (upload it on the SOPs page
 * with ANTHROPIC_API_KEY set; Claude vision transcribes it to markdown).
 * Pure JS (pngjs + embedded 5×7 bitmap font) so it runs with zero system deps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../samples/sop-photo-sample.png');

// 5×7 bitmap font ('#' = ink). Uppercase + digits + punctuation we need.
const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '(': ['..#..', '.#...', '#....', '#....', '#....', '.#...', '..#..'],
  ')': ['..#..', '...#.', '....#', '....#', '....#', '...#.', '..#..'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

const PAGE = [
  { text: 'RANCHO VISTA LECHERIA', scale: 4, gap: 18 },
  { text: 'RUTINA DE ORDENO - HOJA 1', scale: 4, gap: 14 },
  { text: 'DOCUMENTO SOP-ORD-001, REVISION: MARZO 2026', scale: 2, gap: 34 },
  { text: 'PRE-DIP (DESINFECCION ANTES DEL ORDENO)', scale: 3, gap: 14 },
  { text: '1. APLICA EL PRE-DIP CUBRIENDO 3/4 DEL PEZON.', scale: 2, gap: 10 },
  { text: '2. DEJA EL PRE-DIP ACTUAR 30 SEGUNDOS.', scale: 2, gap: 10 },
  { text: '   ESTE TIEMPO ES OBLIGATORIO.', scale: 2, gap: 10 },
  { text: '3. NUNCA REGRESES EL SOBRANTE AL ENVASE.', scale: 2, gap: 30 },
  { text: 'DESPUNTE', scale: 3, gap: 14 },
  { text: '1. SACA 3 A 4 CHORROS POR CUARTO.', scale: 2, gap: 10 },
  { text: '2. SI VES GRUMOS, SANGRE O AGUA, SEPARA', scale: 2, gap: 10 },
  { text: '   LA VACA Y AVISA AL ENCARGADO.', scale: 2, gap: 30 },
  { text: 'SECADO', scale: 3, gap: 14 },
  { text: '1. USA UNA TOALLA POR VACA, NUNCA COMPARTIDA.', scale: 2, gap: 10 },
  { text: '2. SECA BIEN LA PUNTA DEL PEZON.', scale: 2, gap: 10 },
];

const W = 920;
const H = 880;
const MARGIN = 60;

function main() {
  const png = new PNG({ width: W, height: H });

  // Slightly warm off-white paper with gentle vignette, like a phone photo.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (W * y + x) << 2;
      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      const vignette = 1 - 0.08 * (dx * dx + dy * dy);
      const noise = (((x * 7919 + y * 104729) % 13) - 6) * 0.6;
      png.data[i] = Math.min(255, 246 * vignette + noise);
      png.data[i + 1] = Math.min(255, 243 * vignette + noise);
      png.data[i + 2] = Math.min(255, 234 * vignette + noise);
      png.data[i + 3] = 255;
    }
  }

  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (W * y + x) << 2;
    png.data[i] = 38;
    png.data[i + 1] = 36;
    png.data[i + 2] = 40;
    png.data[i + 3] = 255;
  };

  let cursorY = MARGIN;
  for (const line of PAGE) {
    const { text, scale, gap } = line;
    let cursorX = MARGIN;
    for (const ch of text) {
      const glyph = FONT[ch] ?? FONT[' '];
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx] === '#') {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                ink(cursorX + gx * scale + sx, cursorY + gy * scale + sy);
              }
            }
          }
        }
      }
      cursorX += 6 * scale;
    }
    cursorY += 7 * scale + gap;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, PNG.sync.write(png));
  console.log(`✓ Wrote ${OUT} (${W}×${H})`);
  console.log('  Test the OCR path: upload it on the SOPs page with ANTHROPIC_API_KEY set.');
}

main();
