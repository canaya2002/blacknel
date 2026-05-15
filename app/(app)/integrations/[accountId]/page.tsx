import { and, desc, eq } from 'drizzle-orm';
import { AlertTriangle, ArrowLeft, CheckCircle2, Plug, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { requireUser } from '@/lib/auth/server';
import { type Capability, type PlatformCode } from '@/lib/connectors/base';
import { getCapabilities } from '@/lib/connectors/registry';
import { dbAs } from '@/lib/db/client';
import { connectedAccounts, connectorSyncRuns } from '@/lib/db/schema';

import {
  disconnectAccountFormAction,
  reconnectAccountAction,
  syncNowAction,
} from '../actions';

export const dynamic = 'force-dynamic';

interface PageParams {
  accountId: string;
}

interface AccountRow {
  id: string;
  platform: string;
  status: 'connected' | 'disconnected' | 'expired' | 'error';
  displayName: string | null;
  handle: string | null;
  lastSyncAt: Date | null;
  errorMessage: string | null;
  capabilities: unknown;
  brandId: string | null;
  locationId: string | null;
}

interface SyncRunRow {
  id: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: Date;
  finishedAt: Date | null;
  itemsSynced: number;
  errorMessage: string | null;
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<React.ReactElement> {
  const { accountId } = await params;
  const session = await requireUser();

  const [account, runs] = await Promise.all([
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
            errorMessage: connectedAccounts.errorMessage,
            capabilities: connectedAccounts.capabilities,
            brandId: connectedAccounts.brandId,
            locationId: connectedAccounts.locationId,
          })
          .from(connectedAccounts)
          .where(
            and(
              eq(connectedAccounts.id, accountId),
              eq(connectedAccounts.organizationId, session.orgId),
            ),
          )
          .limit(1),
    ).then((r) => r[0]),
    dbAs<SyncRunRow[]>(
      { orgId: session.orgId, userId: session.userId },
      async (tx) =>
        tx
          .select({
            id: connectorSyncRuns.id,
            status: connectorSyncRuns.status,
            startedAt: connectorSyncRuns.startedAt,
            finishedAt: connectorSyncRuns.finishedAt,
            itemsSynced: connectorSyncRuns.itemsSynced,
            errorMessage: connectorSyncRuns.errorMessage,
          })
          .from(connectorSyncRuns)
          .where(eq(connectorSyncRuns.connectedAccountId, accountId))
          .orderBy(desc(connectorSyncRuns.startedAt))
          .limit(20),
    ),
  ]);

  if (!account) notFound();

  const platform = account.platform as PlatformCode;
  const declared = getCapabilities(platform);
  const accountCaps = Array.isArray(account.capabilities)
    ? (account.capabilities as Capability[])
    : declared.supported;

  const needsReconnect = account.status === 'expired' || account.status === 'error';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link
            href="/integrations"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Integrations
          </Link>
        }
        title={account.displayName ?? `${platform} account`}
        description={`${account.handle ?? `@${platform}`} · plataforma ${platform}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <form action={syncNowAction}>
              <input type="hidden" name="accountId" value={account.id} />
              <Button type="submit" variant="outline" size="sm">
                <RefreshCcw className="h-3.5 w-3.5" />
                Sync now
              </Button>
            </form>
            {needsReconnect ? (
              <form action={reconnectAccountAction}>
                <input type="hidden" name="accountId" value={account.id} />
                <Button type="submit" size="sm">
                  Reconectar
                </Button>
              </form>
            ) : null}
            <form action={disconnectAccountFormAction}>
              <input type="hidden" name="accountId" value={account.id} />
              <Button type="submit" variant="ghost" size="sm">
                Desconectar
              </Button>
            </form>
          </div>
        }
      />

      {needsReconnect ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="flex flex-row items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            <div className="flex flex-col">
              <CardTitle className="text-base">
                {account.status === 'expired'
                  ? 'Tokens expirados'
                  : 'Error de plataforma'}
              </CardTitle>
              <CardDescription>
                {account.errorMessage ??
                  'La última sincronización falló. Reconecta para restaurar la cuenta.'}
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Capacidades</CardTitle>
          <CardDescription>
            Lo que esta plataforma permite hacer desde Blacknel. Las capacidades
            con asterisco tienen condiciones — pasa el cursor para leerlas.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {accountCaps.map((cap) => (
            <CapabilityBadge
              key={cap}
              cap={cap}
              note={declared.notes?.[cap]}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial de sincronizaciones</CardTitle>
          <CardDescription>
            Últimos 20 intentos en orden cronológico inverso. Las entradas con
            errores se marcan en rojo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No hay sincronizaciones aún. Usa el botón &laquo;Sync now&raquo; para disparar la primera.
            </p>
          ) : (
            runs.map((run) => <SyncRunRow key={run.id} run={run} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CapabilityBadge({
  cap,
  note,
}: {
  cap: Capability;
  note?: string;
}): React.ReactElement {
  const label = cap.replace(/_/g, ' ');
  if (!note) {
    return (
      <Badge variant="muted">
        <Plug className="h-3 w-3" />
        {label}
      </Badge>
    );
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="muted" className="cursor-help">
            <Plug className="h-3 w-3" />
            {label}*
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs leading-relaxed">{note}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SyncRunRow({ run }: { run: SyncRunRow }): React.ReactElement {
  const failed = run.status === 'failed';
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-card/30 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        {failed ? (
          <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
        )}
        <span className="font-mono text-xs">
          {run.startedAt.toLocaleString()}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{run.itemsSynced} items</span>
        <Badge variant="outline" className="text-[10px] uppercase">
          {run.status}
        </Badge>
        {run.errorMessage ? (
          <span className="max-w-xs truncate text-destructive" title={run.errorMessage}>
            {run.errorMessage}
          </span>
        ) : null}
      </div>
    </div>
  );
}
