/**
 * Minimal dependency-free PDF writer (C52). Enough for a single-page branded
 * report: filled rectangles (brand colour bars) + positioned text in Helvetica /
 * Helvetica-Bold. No external dep (honors "cero red", avoids puppeteer/native
 * binaries, runs in any serverless runtime) and pure → fully unit-testable.
 *
 * Coordinates are PDF user space: origin bottom-left, Y grows upward, A4 =
 * 595×842 pt. `render-report.ts` does the top-down layout math. Text is encoded
 * as WinAnsi (latin1) so Spanish accents render; code points > 0xFF become '?'.
 */

export interface PdfText {
  x: number;
  y: number;
  size: number;
  text: string;
  /** RGB 0..1; defaults to black. */
  color?: readonly [number, number, number];
  bold?: boolean;
}

export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: readonly [number, number, number];
}

export interface PdfContent {
  texts: ReadonlyArray<PdfText>;
  rects: ReadonlyArray<PdfRect>;
  width?: number;
  height?: number;
}

/** '#rrggbb' → [r,g,b] in 0..1. Invalid input → black. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m?.[1]) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function escapePdfText(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0x3f;
    if (ch === '\\' || ch === '(' || ch === ')') out += '\\' + ch;
    else if (code > 0xff) out += '?'; // not representable in WinAnsi
    else out += ch;
  }
  return out;
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function rgbOp(c: readonly [number, number, number]): string {
  return `${fmt(c[0])} ${fmt(c[1])} ${fmt(c[2])} rg`;
}

export function buildPdf(content: PdfContent): Buffer {
  const width = content.width ?? 595;
  const height = content.height ?? 842;

  // ---- content stream ----
  let stream = '';
  for (const r of content.rects) {
    stream += `${rgbOp(r.color)}\n${fmt(r.x)} ${fmt(r.y)} ${fmt(r.w)} ${fmt(r.h)} re\nf\n`;
  }
  for (const t of content.texts) {
    const color = t.color ?? [0, 0, 0];
    const font = t.bold ? '/F2' : '/F1';
    stream +=
      `BT\n${font} ${fmt(t.size)} Tf\n${rgbOp(color)}\n` +
      `${fmt(t.x)} ${fmt(t.y)} Td\n(${escapePdfText(t.text)}) Tj\nET\n`;
  }
  const streamLen = Buffer.byteLength(stream, 'latin1');

  // ---- objects ----
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
    `<< /Length ${streamLen} >>\nstream\n${stream}\nendstream`,
  ];

  // ---- assemble with a correct xref table ----
  const header = '%PDF-1.4\n';
  let body = header;
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, 'latin1');
  const count = objects.length;
  let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'latin1');
}
