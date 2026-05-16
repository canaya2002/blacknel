import { ArrowLeft, AlertTriangle, MessageSquare, Star } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DecisionToolbar } from '@/components/approvals/decision-toolbar';
import { DiffView } from '@/components/approvals/diff-view';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { getApprovalDetail } from '@/lib/approvals/queries';
import { authorize } from '@/lib/permissions/can';

export const dynamic = 'force-dynamic';

interface ApprovalDetailPageProps {
  params: Promise<{ approvalId: string }>;
}

export default async function ApprovalDetailPage({
  params,
}: ApprovalDetailPageProps): Promise<React.ReactElement> {
  const { approvalId } = await params;
  const session = await requireUser();
  authorize(session.role, 'approvals:read');

  const detail = await getApprovalDetail({
    orgId: session.orgId,
    userId: session.userId,
    approvalId,
  });
  if (!detail) notFound();

  const decidable = detail.status === 'pending' || detail.status === 'escalated';
  const threadId =
    typeof detail.proposedPayload.threadId === 'string'
      ? (detail.proposedPayload.threadId as string)
      : null;
  const reviewId =
    typeof detail.proposedPayload.reviewId === 'string'
      ? (detail.proposedPayload.reviewId as string)
      : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Link
          href="/approvals"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          aria-label="Volver a la cola"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold">
            Aprobación: {humanKind(detail.kind)}
          </h1>
          <p className="text-xs text-muted-foreground">
            Solicitada por {detail.requestedByName ?? 'sistema'} ·{' '}
            <time dateTime={detail.createdAt.toISOString()}>
              {detail.createdAt.toLocaleString()}
            </time>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <RiskBadge riskLevel={detail.riskLevel} />
          <StatusBadge status={detail.status} />
        </div>
      </div>

      {detail.kind === 'inbox_reply' && threadId ? (
        <Link
          href={`/inbox/${threadId}` as `/inbox/${string}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Thread origen → /inbox/{threadId.slice(0, 8)}…
        </Link>
      ) : null}

      {detail.kind === 'review_response' && reviewId ? (
        <Link
          href={`/reviews/${reviewId}` as `/reviews/${string}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Star className="h-3.5 w-3.5" />
          Review origen → /reviews/{reviewId.slice(0, 8)}…
        </Link>
      ) : null}

      {detail.aiRiskFlags.length > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="flex flex-row items-start gap-3 pb-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            <div className="flex flex-col">
              <CardTitle className="text-sm">
                Compliance marcó {detail.aiRiskFlags.length} riesgo
                {detail.aiRiskFlags.length === 1 ? '' : 's'}
              </CardTitle>
              <CardDescription>
                Revisa el diff antes de aprobar. La razón completa queda en el
                audit log.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {detail.aiRiskFlags.map((f) => (
              <Badge key={f} variant="muted" className="text-[10px]">
                {f.replace(/_/g, ' ')}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Diff de payload</CardTitle>
          <CardDescription>
            Lo que se propone vs. lo que existía antes (cuando aplica). Líneas
            con fondo ámbar son diferencias.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DiffView
            original={detail.originalPayload}
            proposed={detail.proposedPayload}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Decisión</CardTitle>
          {decidable ? (
            <CardDescription>
              Aprobar dispatcha el efecto (enviar el mensaje en el caso de
              inbox_reply). Si dos moderadores deciden a la vez, el primer
              commit gana — los demás reciben &ldquo;ya fue decidida&rdquo;.
            </CardDescription>
          ) : (
            <CardDescription>
              Decidida por {detail.decidedByName ?? 'usuario eliminado'}
              {detail.decidedAt
                ? ` el ${detail.decidedAt.toLocaleString()}`
                : ''}
              .{' '}
              {detail.decisionReason ? `Razón: ${detail.decisionReason}.` : ''}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <DecisionToolbar
            approvalId={detail.id}
            decidable={decidable}
            proposedPayload={detail.proposedPayload}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function humanKind(k: string): string {
  return (
    {
      inbox_reply: 'Respuesta de inbox',
      review_response: 'Respuesta a reseña',
      post: 'Publicación',
      crisis_response: 'Respuesta de crisis',
      campaign: 'Campaña',
    }[k] ?? k
  );
}

function RiskBadge({ riskLevel }: { riskLevel: string }): React.ReactElement {
  const tone =
    {
      low: 'text-zinc-500',
      medium: 'text-amber-600 dark:text-amber-400',
      high: 'text-orange-600 dark:text-orange-400',
      critical: 'text-red-600 dark:text-red-400',
    }[riskLevel] ?? 'text-zinc-500';
  return (
    <span className={`text-[10px] uppercase ${tone}`}>{`risk: ${riskLevel}`}</span>
  );
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const tone =
    {
      pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      rejected: 'bg-red-500/15 text-red-700 dark:text-red-300',
      edited_approved: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
      escalated: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
      expired: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
    }[status] ?? 'bg-zinc-500/15';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
