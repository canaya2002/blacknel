import 'server-only';

import { randomUUID } from 'node:crypto';

import { getOrgBranding } from '@/lib/branding/org-branding';
import {
  getDataSource,
  supportsScalar,
  type DataSourceContext,
} from '@/lib/custom-reports/data-sources';
import type { CustomReportDataSource } from '@/lib/custom-reports/types';
import { type AnyPgTx, dbAsOrg } from '@/lib/db/client';
import { sendTemplatedEmail } from '@/lib/emails/client';
import type { EmailLocale, TemplateData } from '@/lib/emails/templates';
import { log } from '@/lib/log';
import { putObjectToStorage } from '@/lib/storage/media/client';

import { renderBrandedReportPdf, type ReportSection } from './render-report';

/**
 * White-label report generation + delivery (C52). Runs in a job: under the org's
 * RLS it loads branding + the selected pillars' KPIs (via the custom-report data
 * sources), renders a branded PDF, stores it in R2, and emails each recipient a
 * download link in the org's locale. All external IO is gated by the C44 flags
 * (use_real_storage / use_real_email) — in mock mode the PDF "stores" to a
 * mock:// URL and the email is a no-op log. One org's data never reaches another:
 * every read runs under dbAsOrg(orgId) and the data sources filter by org.
 */

export type ReportPillar = 'publishing' | 'reviews' | 'ads' | 'inbox';

interface PillarDef {
  source: CustomReportDataSource;
  es: string;
  en: string;
  metrics: ReadonlyArray<{ metric: string; es: string; en: string }>;
}

const PILLAR_DEFS: Record<ReportPillar, PillarDef> = {
  publishing: {
    source: 'post_insights',
    es: 'Publicaciones',
    en: 'Publishing',
    metrics: [
      { metric: 'total_reach', es: 'Alcance', en: 'Reach' },
      { metric: 'total_impressions', es: 'Impresiones', en: 'Impressions' },
      { metric: 'total_engagement', es: 'Interacciones', en: 'Engagement' },
    ],
  },
  reviews: {
    source: 'reviews_aggregates',
    es: 'Reseñas',
    en: 'Reviews',
    metrics: [
      { metric: 'avg_rating', es: 'Rating promedio', en: 'Avg rating' },
      { metric: 'review_count', es: 'Reseñas', en: 'Reviews' },
      { metric: 'response_rate', es: 'Tasa de respuesta (%)', en: 'Response rate (%)' },
    ],
  },
  ads: {
    source: 'ads_spend',
    es: 'Publicidad',
    en: 'Ads',
    metrics: [
      { metric: 'spend_usd', es: 'Gasto (USD)', en: 'Spend (USD)' },
      { metric: 'conversions', es: 'Conversiones', en: 'Conversions' },
      { metric: 'ctr', es: 'CTR (%)', en: 'CTR (%)' },
      { metric: 'cpc', es: 'CPC (USD)', en: 'CPC (USD)' },
    ],
  },
  inbox: {
    source: 'inbox_kpis',
    es: 'Inbox',
    en: 'Inbox',
    metrics: [
      { metric: 'avg_response_time_minutes', es: 'Tiempo de respuesta (min)', en: 'Response time (min)' },
    ],
  },
};

export interface GenerateReportInput {
  orgId: string;
  periodDays: number;
  pillars: ReadonlyArray<ReportPillar>;
  recipients: ReadonlyArray<string>;
  now?: string; // ISO; defaults to deps.now()
}

export interface GenerateReportDeps {
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  storePdf: (key: string, bytes: Uint8Array, contentType: string) => Promise<string>;
  sendEmail: (input: {
    template: 'generic_notification';
    to: string;
    locale: EmailLocale;
    data: TemplateData['generic_notification'];
    orgId: string;
    fromName: string;
  }) => Promise<unknown>;
  now: () => Date;
  uuid: () => string;
}

function defaultDeps(): GenerateReportDeps {
  return {
    orgTx: (orgId, fn) => dbAsOrg(orgId, fn),
    storePdf: (key, bytes, contentType) => putObjectToStorage(key, bytes, contentType),
    sendEmail: (input) => sendTemplatedEmail(input),
    now: () => new Date(),
    uuid: () => randomUUID(),
  };
}

export interface GenerateReportResult {
  key: string;
  url: string;
  recipients: ReadonlyArray<string>;
  emailed: number;
}

export async function generateAndDeliverReport(
  input: GenerateReportInput,
  deps: GenerateReportDeps = defaultDeps(),
): Promise<GenerateReportResult> {
  const now = input.now ? new Date(input.now) : deps.now();
  const rangeEnd = now;
  const rangeStart = new Date(now.getTime() - input.periodDays * 24 * 60 * 60 * 1000);

  const { branding, sections } = await deps.orgTx(input.orgId, async (tx) => {
    const branding = await getOrgBranding(tx, input.orgId);
    const sections: ReportSection[] = [];
    for (const pillar of input.pillars) {
      const def = PILLAR_DEFS[pillar];
      if (!def) continue;
      const source = getDataSource(def.source);
      const ctx: DataSourceContext = {
        tx,
        orgId: input.orgId,
        userId: '',
        rangeStart,
        rangeEnd,
        brandId: null,
      };
      const kpis: Array<{ label: string; value: string }> = [];
      for (const m of def.metrics) {
        if (!source.loadScalar || !supportsScalar(source, m.metric)) continue;
        try {
          const r = await source.loadScalar(m.metric, ctx);
          kpis.push({
            label: branding.locale === 'es' ? m.es : m.en,
            value: String(r.value),
          });
        } catch (err) {
          log.warn({ pillar, metric: m.metric, err: (err as Error).message }, 'report.kpi_failed');
        }
      }
      sections.push({ title: branding.locale === 'es' ? def.es : def.en, kpis });
    }
    return { branding, sections };
  });

  const es = branding.locale === 'es';
  const periodLabel = es ? `Últimos ${input.periodDays} días` : `Last ${input.periodDays} days`;
  const generatedAtLabel = now.toISOString().slice(0, 10);

  const pdf = renderBrandedReportPdf({
    branding,
    title: es ? 'Reporte de Analytics' : 'Analytics Report',
    periodLabel,
    generatedAtLabel,
    sections,
  });

  const key = `orgs/${input.orgId}/reports/${deps.uuid()}.pdf`;
  const url = await deps.storePdf(key, pdf, 'application/pdf');

  let emailed = 0;
  for (const to of input.recipients) {
    try {
      await deps.sendEmail({
        template: 'generic_notification',
        to,
        locale: branding.locale,
        orgId: input.orgId,
        fromName: branding.displayName,
        data: {
          title: es
            ? `Tu reporte de ${branding.displayName} está listo`
            : `Your ${branding.displayName} report is ready`,
          body: es
            ? `El reporte de analytics (${periodLabel.toLowerCase()}) está disponible para descargar.`
            : `Your analytics report (${periodLabel.toLowerCase()}) is ready to download.`,
          ctaUrl: url,
          ctaLabel: es ? 'Descargar PDF' : 'Download PDF',
        },
      });
      emailed += 1;
    } catch (err) {
      log.warn({ to, err: (err as Error).message }, 'report.email_failed');
    }
  }

  log.info({ orgId: input.orgId, key, emailed, pillars: input.pillars }, 'report.generated');
  return { key, url, recipients: [...input.recipients], emailed };
}
