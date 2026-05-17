import { Radio } from 'lucide-react';
import Link from 'next/link';

import { ListeningExportButton } from '@/components/listening/listening-export-button';
import { MentionCard } from '@/components/listening/mention-card';
import { TrackedTermPill } from '@/components/listening/tracked-term-pill';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import {
  getListeningAggregates,
  listMentions,
  listTrackedTerms,
} from '@/lib/listening/queries';
import { authorize, can } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

type Tab = 'mentions' | 'leads' | 'terms';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'mentions', label: 'Mentions' },
  { id: 'leads', label: 'Leads' },
  { id: 'terms', label: 'Tracked terms' },
];

interface ListeningPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /listening — Phase 9 / Commit 33.
 *
 * Three tabs (URL-driven via `?tab=`):
 *
 *   - Mentions: feed of captured mentions across all active terms,
 *     with sentiment + triage actions inline.
 *   - Leads: filtered feed (`is_lead=true`).
 *   - Tracked terms: list + "new term" CTA.
 *
 * Plan-gated on Growth+ via `requirePlanFeature(plan,
 * 'listening_mentions')`. Standard sees `<UpgradePrompt />` only.
 * Replaces the Phase-1 stub page that pointed at the legacy
 * `components/common/upgrade-prompt.tsx` (now superseded by the
 * Commit-31 `components/billing/upgrade-prompt.tsx`).
 */
export default async function ListeningPage({
  searchParams,
}: ListeningPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'listening:read');

  const sp = await searchParams;
  const tabRaw = typeof sp.tab === 'string' ? sp.tab : 'mentions';
  const tab: Tab =
    tabRaw === 'leads' || tabRaw === 'terms' ? tabRaw : 'mentions';

  const plan = await getOrgPlanCode(session);
  const allowed = planAllowsNamedFeature(plan, 'listening_mentions');
  const canManage = can(session.role, 'listening:manage');

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Listening"
        description="Capturá menciones de tu marca, hashtags y keywords across redes. La IA clasifica sentiment + leads automáticamente."
        actions={
          allowed && canManage ? (
            <Button asChild size="sm">
              <Link href="/listening/terms/new">Nuevo término</Link>
            </Button>
          ) : null
        }
      />

      {!allowed ? (
        <UpgradePrompt
          unlocksOn="growth"
          featureName="Social listening"
          currentPlan={plan}
          organizationId={session.orgId}
          valueBullets={[
            'Monitor de menciones across Facebook, Instagram, X, Reddit, TikTok, LinkedIn',
            'AI sentiment + lead detection automática por mention',
            'Convierte mentions en threads de inbox con un click',
          ]}
        />
      ) : null}

      <nav className="flex items-center gap-1 border-b">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Link
              key={t.id}
              href={t.id === 'mentions' ? '/listening' : `/listening?tab=${t.id}`}
              className={
                active
                  ? 'border-b-2 border-primary px-4 py-2 text-sm font-medium text-foreground'
                  : 'border-b-2 border-transparent px-4 py-2 text-sm text-muted-foreground hover:text-foreground'
              }
              data-testid={`listening-tab-${t.id}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {allowed && tab === 'mentions' ? (
        <MentionsTab session={session} canManage={canManage} />
      ) : null}
      {allowed && tab === 'leads' ? (
        <LeadsTab session={session} canManage={canManage} />
      ) : null}
      {allowed && tab === 'terms' ? (
        <TermsTab session={session} canManage={canManage} />
      ) : null}
    </div>
  );
}

async function MentionsTab({
  session,
  canManage,
}: {
  session: { orgId: string; userId: string };
  canManage: boolean;
}): Promise<React.ReactElement> {
  const [mentions, aggregates] = await Promise.all([
    listMentions({
      orgId: session.orgId,
      userId: session.userId,
      options: { status: 'all', sinceDays: 30, limit: 100 },
    }),
    getListeningAggregates({
      orgId: session.orgId,
      userId: session.userId,
      sinceDays: 30,
    }),
  ]);
  if (mentions.length === 0) {
    return (
      <EmptyState
        icon={Radio}
        title="Sin menciones todavía"
        description="Una vez que el cron de listening capture la primera tanda (cada 60 min), las menciones aparecerán acá."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiTile label="Total 30d" value={String(aggregates.total)} />
        <KpiTile
          label="Positive"
          value={String(aggregates.bySentiment.positive)}
          tone="positive"
        />
        <KpiTile
          label="Neutral"
          value={String(aggregates.bySentiment.neutral)}
          tone="neutral"
        />
        <KpiTile
          label="Negative"
          value={String(aggregates.bySentiment.negative)}
          tone="negative"
        />
        <KpiTile label="Leads" value={String(aggregates.leads)} tone="lead" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {mentions.length} menciones recientes
        </span>
        <ListeningExportButton period="30d" status="all" brandId={null} />
      </div>
      <div className="flex flex-col gap-2">
        {mentions.map((m) => (
          <MentionCard key={m.id} mention={m} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}

async function LeadsTab({
  session,
  canManage,
}: {
  session: { orgId: string; userId: string };
  canManage: boolean;
}): Promise<React.ReactElement> {
  const mentions = await listMentions({
    orgId: session.orgId,
    userId: session.userId,
    options: { isLead: true, sinceDays: 90, limit: 100 },
  });
  if (mentions.length === 0) {
    return (
      <EmptyState
        icon={Radio}
        title="Sin leads detectados"
        description="La IA marca como lead las menciones con intent='sales_inquiry' o 'info_request'. Cuando aparezcan, las verás aquí."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {mentions.map((m) => (
        <MentionCard key={m.id} mention={m} canManage={canManage} />
      ))}
    </div>
  );
}

async function TermsTab({
  session,
  canManage,
}: {
  session: { orgId: string; userId: string };
  canManage: boolean;
}): Promise<React.ReactElement> {
  const terms = await listTrackedTerms({
    orgId: session.orgId,
    userId: session.userId,
  });
  if (terms.length === 0) {
    return (
      <EmptyState
        icon={Radio}
        title="Aún no hay términos"
        description="Agregá keywords, hashtags o handles que querés monitorear. El cron empieza a capturar mentions en la siguiente hora."
        primary={
          canManage
            ? { label: 'Crear término', href: '/listening/terms/new' }
            : {
                label: 'Crear término',
                disabledReason: 'Tu rol no permite gestionar términos.',
              }
        }
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {terms.map((t) => (
        <Card key={t.id} className="flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between">
            <TrackedTermPill term={t.term} termKind={t.termKind} />
            <span
              className={
                t.status === 'active'
                  ? 'rounded-md border border-emerald-500/40 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'rounded-md border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground'
              }
            >
              {t.status}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
            {t.platforms.map((p) => (
              <span
                key={p}
                className="rounded border bg-muted/50 px-1.5 py-0.5"
              >
                {p}
              </span>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {t.brandName ?? 'Todas las brands'} · {t.mentionCount} mentions
          </span>
        </Card>
      ))}
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'neutral' | 'negative' | 'lead';
}): React.ReactElement {
  const cls =
    tone === 'positive'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'negative'
        ? 'text-rose-700 dark:text-rose-300'
        : tone === 'lead'
          ? 'text-violet-700 dark:text-violet-300'
          : 'text-foreground';
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`text-2xl font-semibold tabular-nums ${cls}`}>
        {value}
      </span>
    </Card>
  );
}
