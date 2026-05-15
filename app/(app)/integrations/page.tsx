import { eq } from 'drizzle-orm';
import Link from 'next/link';

import { PageHeader } from '@/components/common/page-header';
import { PlatformTile } from '@/components/integrations/platform-tile';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { type PlatformCode } from '@/lib/connectors/base';
import { maybeTickConnectorEvents } from '@/lib/connectors/dev-events';
import { listConnectorsForPlan } from '@/lib/connectors/registry';
import { dbAs } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { getOrgPlanCode } from '@/lib/queries/plan';

interface AccountRow {
  id: string;
  platform: string;
  status: 'connected' | 'disconnected' | 'expired' | 'error';
  displayName: string | null;
  handle: string | null;
  lastSyncAt: Date | null;
}

export default async function IntegrationsPage(): Promise<React.ReactElement> {
  const session = await requireUser();

  // Synthetic event tick (dev-only) — throttled to once per minute per process.
  await maybeTickConnectorEvents();

  const [planCode, accounts] = await Promise.all([
    getOrgPlanCode(session),
    dbAs<AccountRow[]>(
      { orgId: session.orgId, userId: session.userId },
      async (tx) =>
        tx
          .select({
            id: connectedAccounts.id,
            platform: connectedAccounts.platform,
            status: connectedAccounts.status,
            displayName: connectedAccounts.displayName,
            handle: connectedAccounts.handle,
            lastSyncAt: connectedAccounts.lastSyncAt,
          })
          .from(connectedAccounts)
          .where(eq(connectedAccounts.organizationId, session.orgId)),
    ),
  ]);

  const connectorEntries = listConnectorsForPlan(planCode);

  // Aggregate counts per platform.
  const countsByPlatform = new Map<PlatformCode, { connected: number; problem: number }>();
  for (const acc of accounts) {
    const platform = acc.platform as PlatformCode;
    const slot = countsByPlatform.get(platform) ?? { connected: 0, problem: 0 };
    if (acc.status === 'connected') slot.connected += 1;
    else if (acc.status === 'expired' || acc.status === 'error') slot.problem += 1;
    countsByPlatform.set(platform, slot);
  }

  const includesMock = env.NODE_ENV !== 'production';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integrations"
        description="Centro de conexiones con tus redes y plataformas de reseñas. Cada conector declara sus capacidades reales — Yelp es read-only, BBB es CSV manual, Avvo está pendiente legal. Lo que ves aquí es lo que la API permite hacer desde Blacknel."
      />

      {accounts.length > 0 ? <ConnectedAccountsList accounts={accounts} /> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {connectorEntries.map((entry) => {
          const counts = countsByPlatform.get(entry.platform) ?? {
            connected: 0,
            problem: 0,
          };
          return (
            <PlatformTile
              key={entry.platform}
              platform={entry.platform}
              available={entry.available}
              gatedBy={entry.gatedBy}
              capabilities={entry.capabilities}
              connectedCount={counts.connected}
              problemCount={counts.problem}
            />
          );
        })}
        {includesMock ? <MockTile /> : null}
      </div>
    </div>
  );
}

function MockTile(): React.ReactElement {
  return (
    <Card className="border-dashed bg-muted/20">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-500 text-xs font-bold text-white"
            aria-hidden
          >
            DEV
          </div>
          <div>
            <CardTitle className="text-base">Mock connector</CardTitle>
            <CardDescription>
              Solo visible en dev. Usado por las suites de tests para ejercitar el
              flujo end-to-end sin caer en una plataforma real.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Badge variant="outline">No conectable desde UI</Badge>
      </CardContent>
    </Card>
  );
}

function ConnectedAccountsList({
  accounts,
}: {
  accounts: ReadonlyArray<AccountRow>;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cuentas conectadas ({accounts.length})</CardTitle>
        <CardDescription>
          Clic en cualquiera para gestionar capacidades, ver historial de sync,
          reconectar o desconectar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {accounts.map((acc) => (
          <Link
            key={acc.id}
            href={`/integrations/${acc.id}`}
            className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:bg-accent/30"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">
                {acc.displayName ?? `${acc.platform} account`}
              </span>
              <span className="text-xs text-muted-foreground">
                {acc.handle ?? acc.platform} ·{' '}
                {acc.lastSyncAt
                  ? `Última sync ${acc.lastSyncAt.toLocaleString()}`
                  : 'Sin sync aún'}
              </span>
            </div>
            <StatusBadge status={acc.status} />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  status,
}: {
  status: 'connected' | 'disconnected' | 'expired' | 'error';
}): React.ReactElement {
  const variant = {
    connected: {
      className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      label: 'Conectado',
    },
    disconnected: { className: 'bg-muted text-muted-foreground', label: 'Desconectado' },
    expired: {
      className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      label: 'Expirado',
    },
    error: {
      className: 'bg-red-500/15 text-red-700 dark:text-red-300',
      label: 'Error',
    },
  }[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${variant.className}`}
    >
      {variant.label}
    </span>
  );
}
