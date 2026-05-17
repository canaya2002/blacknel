import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { CampaignForm } from '@/components/campaigns/campaign-form';
import { CampaignManualSpentForm } from '@/components/campaigns/campaign-manual-spent-form';
import { CampaignPostsTab } from '@/components/campaigns/campaign-posts-tab';
import { CampaignStatusBadge } from '@/components/campaigns/campaign-status-badge';
import { CampaignStatusTransitions } from '@/components/campaigns/campaign-status-transitions';
import { CampaignTimeline } from '@/components/campaigns/campaign-timeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { getCampaignDetail, getPostsByCampaignWithTx } from '@/lib/campaigns/queries';
import { dbAs } from '@/lib/db/client';
import { allowedCampaignTransitionsFrom } from '@/lib/campaigns/validate';
import { authorize, can } from '@/lib/permissions/can';
import {
  getOrgTimezoneWithTx,
  listBrandOptionsWithTx,
} from '@/lib/publish/picker-data';

export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();
const ALLOWED_TABS = ['resumen', 'posts', 'config'] as const;
type TabKey = (typeof ALLOWED_TABS)[number];

interface CampaignDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const GOAL_LABEL: Record<string, string> = {
  awareness: 'Awareness',
  engagement: 'Engagement',
  leads: 'Leads',
  reviews: 'Reseñas',
  reputation: 'Reputación',
  event: 'Evento',
  launch: 'Lanzamiento',
  promotion: 'Promoción',
  education: 'Educación',
  crisis: 'Crisis',
  seasonal: 'Estacional',
  evergreen: 'Evergreen',
};

export default async function CampaignDetailPage({
  params,
  searchParams,
}: CampaignDetailPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'campaigns:read');

  const { id } = await params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const detail = await getCampaignDetail({
    orgId: session.orgId,
    userId: session.userId,
    campaignId: parsedId.data,
  });
  if (!detail) notFound();

  const sp = await searchParams;
  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const tab: TabKey =
    rawTab && (ALLOWED_TABS as ReadonlyArray<string>).includes(rawTab)
      ? (rawTab as TabKey)
      : 'resumen';

  const now = new Date();
  const allowedTransitions = allowedCampaignTransitionsFrom(detail.status);
  const canUpdate = can(session.role, 'campaigns:update');

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b bg-card/30 px-6 py-3">
        <Button asChild size="icon" variant="ghost" className="h-8 w-8">
          <Link href="/publish/campaigns" prefetch={false} aria-label="Volver a campañas">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight">
              {detail.name}
            </h1>
            <CampaignStatusBadge status={detail.status} />
            <Badge variant="muted" className="text-[10px] uppercase">
              {GOAL_LABEL[detail.goal] ?? detail.goal}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {detail.brandName ? `${detail.brandName} · ` : ''}
            {detail.ownerName ? `Owner: ${detail.ownerName}` : 'sin owner'}
          </p>
        </div>
        {canUpdate && allowedTransitions.length > 0 ? (
          <CampaignStatusTransitions
            campaignId={detail.id}
            allowedTransitions={allowedTransitions}
          />
        ) : null}
      </header>

      <nav className="flex gap-1 border-b bg-card/20 px-6">
        <TabLink current={tab} value="resumen" label="Resumen" />
        <TabLink current={tab} value="posts" label="Posts" count={detail.postCount} />
        {canUpdate ? (
          <TabLink current={tab} value="config" label="Configuración" />
        ) : null}
      </nav>

      <div className="flex flex-col gap-4 p-6">
        {tab === 'resumen' ? <ResumenTab detail={detail} now={now} /> : null}
        {tab === 'posts' ? (
          <PostsTabWrapper
            campaignId={detail.id}
            orgId={session.orgId}
            userId={session.userId}
          />
        ) : null}
        {tab === 'config' && canUpdate ? (
          <ConfigTabWrapper
            campaignId={detail.id}
            orgId={session.orgId}
            userId={session.userId}
            detail={detail}
          />
        ) : null}
      </div>
    </div>
  );
}

function TabLink({
  current,
  value,
  label,
  count,
}: {
  current: TabKey;
  value: TabKey;
  label: string;
  count?: number;
}): React.ReactElement {
  const active = current === value;
  return (
    <Link
      href={`?tab=${value}`}
      prefetch={false}
      scroll={false}
      className={
        active
          ? 'border-b-2 border-foreground px-3 py-2 text-sm font-medium'
          : 'border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
      }
    >
      {label}
      {count !== undefined ? (
        <span className="ml-1.5 text-[10px] text-muted-foreground">{count}</span>
      ) : null}
    </Link>
  );
}

interface ResumenProps {
  detail: Awaited<ReturnType<typeof getCampaignDetail>>;
  now: Date;
}

function ResumenTab({ detail, now }: ResumenProps): React.ReactElement {
  if (!detail) return <></>;
  const budget = detail.budgetCents;
  const spent = detail.manualSpentCents;
  const ratio =
    budget !== null && budget > 0 && spent !== null
      ? Math.min(100, Math.round((spent / budget) * 100))
      : null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">KPIs</CardTitle>
          <CardDescription>
            Métricas de posts asociados. Engagement real se cablea en Fase 8.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <KpiRow label="Posts totales" value={String(detail.postCount)} />
          <KpiRow label="Programados" value={String(detail.scheduledPostCount)} />
          <KpiRow label="Publicados" value={String(detail.publishedPostCount)} />
          <KpiRow label="Fallidos" value={String(detail.failedPostCount)} />
          <KpiRow label="Engagement" value="—" muted />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cronograma</CardTitle>
          <CardDescription>
            La campaña empieza el {fmt(detail.startsAt)} y termina el{' '}
            {fmt(detail.endsAt)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignTimeline
            startsAt={detail.startsAt}
            endsAt={detail.endsAt}
            now={now}
          />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Budget</CardTitle>
          <CardDescription>
            El gasto real se calcula en Fase 8 desde las cuentas de ads
            conectadas. Por ahora puedes capturarlo manualmente en la
            pestaña Configuración.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold">
              {spent !== null ? fmtCents(spent) : fmtCents(0)}
            </span>
            <span className="text-muted-foreground">
              / {budget !== null ? fmtCents(budget) : 'sin budget'}
            </span>
          </div>
          {ratio !== null ? (
            <div className="flex flex-col gap-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-foreground/70"
                  style={{ width: `${ratio}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground">
                {ratio}% consumido
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Define un budget en la pestaña Configuración para ver % consumido.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={muted ? 'text-muted-foreground' : 'text-foreground'}>
        {value}
      </span>
    </div>
  );
}

async function PostsTabWrapper({
  campaignId,
  orgId,
  userId,
}: {
  campaignId: string;
  orgId: string;
  userId: string;
}): Promise<React.ReactElement> {
  const [postIds, presentation] = await Promise.all([
    dbAs({ orgId, userId }, (tx) =>
      getPostsByCampaignWithTx(tx, { orgId, campaignId }),
    ),
    dbAs({ orgId, userId }, (tx) => getOrgTimezoneWithTx(tx, orgId)),
  ]);
  return (
    <CampaignPostsTab
      orgId={orgId}
      userId={userId}
      postIds={postIds}
      timeZone={presentation.timezone}
      locale={presentation.locale}
    />
  );
}

async function ConfigTabWrapper({
  campaignId,
  orgId,
  userId,
  detail,
}: {
  campaignId: string;
  orgId: string;
  userId: string;
  detail: NonNullable<Awaited<ReturnType<typeof getCampaignDetail>>>;
}): Promise<React.ReactElement> {
  const brandOptions = await dbAs({ orgId, userId }, (tx) =>
    listBrandOptionsWithTx(tx, orgId),
  );
  return (
    <div className="flex flex-col gap-4">
      <CampaignForm
        mode="edit"
        brandOptions={brandOptions}
        initial={{
          campaignId,
          name: detail.name,
          goal: detail.goal,
          brandId: detail.brandId,
          startsAt: detail.startsAt,
          endsAt: detail.endsAt,
          budgetCents: detail.budgetCents,
        }}
      />
      <CampaignManualSpentForm
        campaignId={campaignId}
        currentManualSpentCents={detail.manualSpentCents}
        budgetCents={detail.budgetCents}
      />
    </div>
  );
}

function fmt(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString();
}

function fmtCents(c: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(c / 100);
}
