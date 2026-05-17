import 'server-only';

/**
 * Scheduled-report HTML builder (Phase 9 / Commit 34, Ajuste A).
 *
 * HTML emails require table-based layouts for cross-client
 * compatibility (Outlook, Gmail, Apple Mail). DO NOT use
 * flexbox/grid/modern CSS. Phase 11 may swap to react-email for
 * component-based templates.
 *
 * Sections (Ajuste A minimal base):
 *   1. Header — brand name + period.
 *   2. KPI cards — 4 cells (response time, NPS, posts, ads spend).
 *   3. Inbox table — platform / threads / response time /
 *      satisfaction.
 *   4. Reviews table — count / avg rating / response rate /
 *      sentiment.
 *   5. Top mentions — listening top 5 (only if `mentions` non-empty).
 *   6. Footer.
 *
 * Everything inline. The text fallback (`renderText`) is the plain
 * companion used for email clients that block HTML.
 *
 * LOC target: ≤ 300. This file stays vanilla — see Commit 34's
 * D-34-3 / R-34-3 decision.
 */

export interface ReportPeriod {
  readonly label: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

export interface ReportKpis {
  readonly responseTimeMinsP50: number | null;
  readonly npsScore: number | null;
  readonly postsPublished: number;
  readonly adsSpendUsdCents: number;
}

export interface ReportInboxRow {
  readonly platform: string;
  readonly threads: number;
  readonly responseTimeMinsP50: number | null;
  readonly satisfactionPct: number | null;
}

export interface ReportReviewsRow {
  readonly platform: string;
  readonly count: number;
  readonly avgRating: number | null;
  readonly responseRatePct: number;
  readonly sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
}

export interface ReportTopMention {
  readonly platform: string;
  readonly authorHandle: string;
  readonly bodyExcerpt: string;
  readonly sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
}

export interface ReportPayload {
  readonly brandName: string;
  readonly period: ReportPeriod;
  readonly kpis: ReportKpis;
  readonly inbox: ReadonlyArray<ReportInboxRow>;
  readonly reviews: ReadonlyArray<ReportReviewsRow>;
  readonly mentions: ReadonlyArray<ReportTopMention>;
  readonly generatedAt: Date;
}

const COLOR = {
  bg: '#f4f5f7',
  card: '#ffffff',
  border: '#e4e6ea',
  text: '#1f2328',
  muted: '#6e7681',
  good: '#1a7f37',
  warn: '#9a6700',
  bad: '#cf222e',
  brand: '#5b3df5',
} as const;

const SENT_BG: Record<ReportReviewsRow['sentiment'], string> = {
  positive: '#dafbe1',
  neutral: '#eaeef2',
  negative: '#ffebe9',
  unknown: '#eaeef2',
};
const SENT_FG: Record<ReportReviewsRow['sentiment'], string> = {
  positive: COLOR.good,
  neutral: COLOR.muted,
  negative: COLOR.bad,
  unknown: COLOR.muted,
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMin(m: number | null): string {
  if (m === null) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function kpi(label: string, value: string, accent = COLOR.text): string {
  return `<td style="padding:16px;background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:6px" align="left" valign="top">
    <div style="font-size:11px;color:${COLOR.muted};text-transform:uppercase;letter-spacing:0.6px">${esc(label)}</div>
    <div style="font-size:24px;color:${accent};font-weight:600;margin-top:6px">${esc(value)}</div>
  </td>`;
}

function sentimentBadge(s: ReportReviewsRow['sentiment']): string {
  return `<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:${SENT_BG[s]};color:${SENT_FG[s]};font-size:11px;font-weight:600">${esc(s)}</span>`;
}

function inboxTable(rows: ReadonlyArray<ReportInboxRow>): string {
  if (rows.length === 0) {
    return `<div style="color:${COLOR.muted};font-style:italic">Sin actividad inbox en el período.</div>`;
  }
  const body = rows
    .map(
      (r) =>
        `<tr><td style="padding:8px;border-top:1px solid ${COLOR.border}">${esc(r.platform)}</td><td style="padding:8px;border-top:1px solid ${COLOR.border}" align="right">${r.threads}</td><td style="padding:8px;border-top:1px solid ${COLOR.border}" align="right">${esc(fmtMin(r.responseTimeMinsP50))}</td><td style="padding:8px;border-top:1px solid ${COLOR.border}" align="right">${r.satisfactionPct === null ? '—' : `${r.satisfactionPct}%`}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${COLOR.border};border-collapse:collapse;border-radius:6px;background:${COLOR.card}"><thead><tr><th align="left" style="padding:8px;font-size:11px;color:${COLOR.muted};text-transform:uppercase">Platform</th><th align="right" style="padding:8px;font-size:11px;color:${COLOR.muted};text-transform:uppercase">Threads</th><th align="right" style="padding:8px;font-size:11px;color:${COLOR.muted};text-transform:uppercase">Response p50</th><th align="right" style="padding:8px;font-size:11px;color:${COLOR.muted};text-transform:uppercase">Satisfaction</th></tr></thead><tbody>${body}</tbody></table>`;
}

function reviewsTable(rows: ReadonlyArray<ReportReviewsRow>): string {
  if (rows.length === 0) {
    return `<div style="color:${COLOR.muted};font-style:italic">Sin reviews en el período.</div>`;
  }
  const body = rows
    .map(
      (r) =>
        `<tr><td style="padding:8px;border-top:1px solid ${COLOR.border}">${esc(r.platform)}</td><td style="padding:8px;border-top:1px solid ${COLOR.border}" align="right">${r.count}</td><td style="padding:8px;border-top:1px solid ${COLOR.border}" align="right">${r.avgRating === null ? '—' : r.avgRating.toFixed(2)}</td><td style="padding:8px;border-top:1px solid ${COLOR.border}" align="right">${r.responseRatePct}%</td><td style="padding:8px;border-top:1px solid ${COLOR.border}" align="right">${sentimentBadge(r.sentiment)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${COLOR.border};border-collapse:collapse;border-radius:6px;background:${COLOR.card}"><thead><tr><th align="left" style="padding:8px;font-size:11px;color:${COLOR.muted};text-transform:uppercase">Platform</th><th align="right" style="padding:8px;font-size:11px;color:${COLOR.muted};text-transform:uppercase">Count</th><th align="right" style="padding:8px;font-size:11px;color:${COLOR.muted};text-transform:uppercase">Avg rating</th><th align="right" style="padding:8px;font-size:11px;color:${COLOR.muted};text-transform:uppercase">Response rate</th><th align="right" style="padding:8px;font-size:11px;color:${COLOR.muted};text-transform:uppercase">Sentiment</th></tr></thead><tbody>${body}</tbody></table>`;
}

function topMentions(rows: ReadonlyArray<ReportTopMention>): string {
  if (rows.length === 0) return '';
  const items = rows
    .map(
      (m) =>
        `<li style="margin-bottom:10px;padding:8px;background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:4px;list-style:none"><div style="font-size:12px;color:${COLOR.muted}">@${esc(m.authorHandle)} · ${esc(m.platform)} ${sentimentBadge(m.sentiment)}</div><div style="font-size:13px;color:${COLOR.text};margin-top:4px">${esc(m.bodyExcerpt)}</div></li>`,
    )
    .join('');
  return `<h2 style="font-size:16px;color:${COLOR.text};margin:24px 0 12px">Top mentions</h2><ul style="padding:0;margin:0">${items}</ul>`;
}

export function renderReportHtml(payload: ReportPayload): string {
  const periodLabel = `${esc(payload.period.label)} · ${payload.period.startAt.toISOString().slice(0, 10)} → ${payload.period.endAt.toISOString().slice(0, 10)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(payload.brandName)} · ${esc(payload.period.label)}</title></head><body style="margin:0;padding:0;background:${COLOR.bg};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${COLOR.text}"><table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:24px"><table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:${COLOR.bg}">
<tr><td style="padding:16px 0"><table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="left"><div style="font-size:11px;color:${COLOR.muted};text-transform:uppercase;letter-spacing:0.6px">Blacknel report</div><div style="font-size:22px;color:${COLOR.text};font-weight:600">${esc(payload.brandName)}</div><div style="font-size:12px;color:${COLOR.muted};margin-top:4px">${periodLabel}</div></td><td align="right" style="width:48px;height:48px"><div style="width:40px;height:40px;background:${COLOR.brand};border-radius:8px;color:white;font-weight:700;text-align:center;font-size:18px;line-height:40px">${esc((payload.brandName[0] ?? '?').toUpperCase())}</div></td></tr></table></td></tr>
<tr><td style="padding:8px 0"><table role="presentation" cellpadding="0" cellspacing="8" width="100%"><tr>${kpi('Response p50', fmtMin(payload.kpis.responseTimeMinsP50))}${kpi('NPS', payload.kpis.npsScore === null ? '—' : String(payload.kpis.npsScore))}${kpi('Posts published', String(payload.kpis.postsPublished))}${kpi('Ads spend', fmtMoney(payload.kpis.adsSpendUsdCents))}</tr></table></td></tr>
<tr><td style="padding:16px 0"><h2 style="font-size:16px;color:${COLOR.text};margin:0 0 8px">Inbox</h2>${inboxTable(payload.inbox)}</td></tr>
<tr><td style="padding:0 0 16px"><h2 style="font-size:16px;color:${COLOR.text};margin:0 0 8px">Reviews</h2>${reviewsTable(payload.reviews)}</td></tr>
<tr><td>${topMentions(payload.mentions)}</td></tr>
<tr><td align="center" style="padding:24px 0;font-size:11px;color:${COLOR.muted}">Generated by Blacknel · ${esc(payload.generatedAt.toISOString())}</td></tr>
</table></td></tr></table></body></html>`;
}

export function renderReportText(payload: ReportPayload): string {
  const lines: string[] = [];
  lines.push(`Blacknel report · ${payload.brandName}`);
  lines.push(
    `${payload.period.label} · ${payload.period.startAt.toISOString().slice(0, 10)} → ${payload.period.endAt.toISOString().slice(0, 10)}`,
  );
  lines.push('');
  lines.push('KPIs');
  lines.push(`  Response p50: ${fmtMin(payload.kpis.responseTimeMinsP50)}`);
  lines.push(
    `  NPS:          ${payload.kpis.npsScore === null ? '—' : payload.kpis.npsScore}`,
  );
  lines.push(`  Posts:        ${payload.kpis.postsPublished}`);
  lines.push(`  Ads spend:    ${fmtMoney(payload.kpis.adsSpendUsdCents)}`);
  lines.push('');
  lines.push(`Inbox (${payload.inbox.length} platforms)`);
  for (const r of payload.inbox) {
    lines.push(
      `  ${r.platform.padEnd(10)} threads=${r.threads} resp=${fmtMin(r.responseTimeMinsP50)} sat=${r.satisfactionPct ?? '—'}`,
    );
  }
  lines.push('');
  lines.push(`Reviews (${payload.reviews.length} platforms)`);
  for (const r of payload.reviews) {
    lines.push(
      `  ${r.platform.padEnd(10)} count=${r.count} rating=${r.avgRating?.toFixed(2) ?? '—'} resp=${r.responseRatePct}% sentiment=${r.sentiment}`,
    );
  }
  if (payload.mentions.length > 0) {
    lines.push('');
    lines.push('Top mentions');
    for (const m of payload.mentions) {
      lines.push(
        `  @${m.authorHandle} (${m.platform}, ${m.sentiment}): ${m.bodyExcerpt}`,
      );
    }
  }
  lines.push('');
  lines.push(`Generated by Blacknel · ${payload.generatedAt.toISOString()}`);
  return lines.join('\n');
}
