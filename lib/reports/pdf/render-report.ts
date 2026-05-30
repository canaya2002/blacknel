import type { OrgBranding } from '@/lib/branding/org-branding';

import { buildPdf, hexToRgb, type PdfRect, type PdfText } from './pdf-builder';

/**
 * White-label branded report renderer (C52). Lays out a single-page A4 PDF:
 * a header bar in the org's primary colour with its display name, then one
 * section per pillar with label/value KPI rows. Pure (PDF builder is
 * dependency-free) → deterministic + unit-testable. Logo embedding is a
 * follow-up (needs image XObject encoding); the logo URL surfaces in the email.
 */

export interface ReportKpi {
  readonly label: string;
  readonly value: string;
}
export interface ReportSection {
  readonly title: string;
  readonly kpis: ReadonlyArray<ReportKpi>;
}
export interface BrandedReportInput {
  readonly branding: OrgBranding;
  readonly title: string;
  readonly periodLabel: string;
  readonly generatedAtLabel: string;
  readonly sections: ReadonlyArray<ReportSection>;
}

const W = 595;
const H = 842;
const MARGIN = 48;
const WHITE: [number, number, number] = [1, 1, 1];
const MUTED: [number, number, number] = [0.42, 0.45, 0.5];

export function renderBrandedReportPdf(input: BrandedReportInput): Uint8Array {
  const rects: PdfRect[] = [];
  const texts: PdfText[] = [];
  const primary = hexToRgb(input.branding.primaryColor);
  const secondary = hexToRgb(input.branding.secondaryColor);
  const top = (y: number): number => H - y; // top-down layout → PDF coords

  // Header bar.
  rects.push({ x: 0, y: H - 92, w: W, h: 92, color: primary });
  texts.push({ x: MARGIN, y: top(42), size: 22, text: input.branding.displayName, color: WHITE, bold: true });
  texts.push({ x: MARGIN, y: top(66), size: 12, text: input.title, color: WHITE });
  texts.push({ x: W - MARGIN - 190, y: top(42), size: 10, text: input.periodLabel, color: WHITE });
  texts.push({ x: W - MARGIN - 190, y: top(58), size: 9, text: input.generatedAtLabel, color: WHITE });

  let cursor = 132;
  for (const section of input.sections) {
    if (cursor > H - 90) break; // single-page cap
    texts.push({ x: MARGIN, y: top(cursor), size: 13, text: section.title, color: secondary, bold: true });
    rects.push({ x: MARGIN, y: top(cursor + 6), w: W - 2 * MARGIN, h: 1.2, color: primary });
    cursor += 26;
    for (const kpi of section.kpis) {
      if (cursor > H - 70) break;
      texts.push({ x: MARGIN + 6, y: top(cursor), size: 10, text: kpi.label, color: MUTED });
      texts.push({ x: W - MARGIN - 170, y: top(cursor), size: 11, text: kpi.value, color: secondary, bold: true });
      cursor += 18;
    }
    cursor += 16;
  }

  texts.push({
    x: MARGIN,
    y: 34,
    size: 8,
    text: `${input.branding.displayName} · ${input.generatedAtLabel}`,
    color: MUTED,
  });

  return buildPdf({ texts, rects, width: W, height: H });
}
