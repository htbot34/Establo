import PDFDocument from 'pdfkit';

export type PdfBuilder = (doc: PDFKit.PDFDocument) => void;

/** Build a PDF in memory with pdfkit and return the bytes. */
export function pdfToBuffer(
  options: PDFKit.PDFDocumentOptions,
  build: PdfBuilder,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(options);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export const PDF_COLORS = {
  ink: '#1c1917',
  muted: '#57534e',
  accent: '#166534',
  line: '#d6d3d1',
  faint: '#f5f5f4',
} as const;

/** Simple text-table row renderer used by the audit letter and transcripts. */
export function drawTableRow(
  doc: PDFKit.PDFDocument,
  y: number,
  cells: string[],
  widths: number[],
  opts: { bold?: boolean; fontSize?: number; x?: number } = {},
): number {
  const x0 = opts.x ?? doc.page.margins.left;
  const fontSize = opts.fontSize ?? 9;
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
  let maxHeight = 0;
  cells.forEach((cell, i) => {
    const x = x0 + widths.slice(0, i).reduce((a, b) => a + b, 0);
    const w = widths[i] - 6;
    const h = doc.heightOfString(cell, { width: w });
    doc.fillColor(PDF_COLORS.ink).text(cell, x, y, { width: w });
    maxHeight = Math.max(maxHeight, h);
  });
  return y + maxHeight + 6;
}
