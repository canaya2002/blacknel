import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/common/upgrade-prompt';
import { ApprovalsList } from '@/components/approvals/approvals-list';
import { ApprovalsListPolling } from '@/components/approvals/approvals-polling';
import {
  EmptyApprovalsNarrowSlice,
  EmptyApprovalsNoMatches,
  EmptyApprovalsQueueClear,
} from '@/components/approvals/empty-states';
import { FiltersBar } from '@/components/approvals/filters-bar';
import { requireUser } from '@/lib/auth/server';
import { decodeApprovalCursor } from '@/lib/approvals/cursor';
import { hasActiveFilters, parseApprovalFilters } from '@/lib/approvals/filters';
import { listApprovals } from '@/lib/approvals/queries';
import { authorize } from '@/lib/permissions/can';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

const PLAN_RANK = { standard: 0, growth: 1, enterprise: 2 } as const;

interface ApprovalsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ApprovalsPage({
  searchParams,
}: ApprovalsPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'approvals:read');

  const plan = await getOrgPlanCode(session);
  const gated = PLAN_RANK[plan] < PLAN_RANK.growth;
  if (gated) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Approvals"
          description="Cola de aprobaciones para contenido sensible. Disponible en Growth."
        />
        <UpgradePrompt
          unlocksOn="growth"
          feature="Approvals"
          description="Las aprobaciones se desbloquean en el plan Growth — agregan revisión obligatoria a contenido sensible y respuestas con datos personales antes de que salgan al público."
        />
      </div>
    );
  }

  const sp = await searchParams;
  const { filters, cursor: rawCursor, defaulted } = parseApprovalFilters(sp);
  const cursor = decodeApprovalCursor(rawCursor ?? null);

  const page = await listApprovals({
    orgId: session.orgId,
    userId: session.userId,
    filters,
    cursor,
  });

  const active = hasActiveFilters(filters);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <ApprovalsListPolling />
      <PageHeader
        title="Approvals"
        description="Cola de aprobaciones para respuestas sensibles. Quien aprueba ve el borrador, el contexto y los riesgos detectados antes de decidir."
      />

      <FiltersBar filters={filters} defaulted={defaulted} />

      <div className="flex-1 overflow-hidden">
        {page.approvals.length > 0 ? (
          <ApprovalsList
            initialApprovals={page.approvals}
            initialNextCursor={page.nextCursor}
            filters={filters}
          />
        ) : defaulted ? (
          // First load with default filters and nothing actionable.
          <EmptyApprovalsQueueClear />
        ) : isNarrowSlice(filters) ? (
          <EmptyApprovalsNarrowSlice scopeLabel={narrowSliceLabel(filters)} />
        ) : active ? (
          <EmptyApprovalsNoMatches />
        ) : (
          <EmptyApprovalsQueueClear />
        )}
      </div>
    </div>
  );
}

function isNarrowSlice(filters: { status?: ReadonlyArray<string> }): boolean {
  if (!filters.status?.length) return false;
  return filters.status.every(
    (s) => s === 'approved' || s === 'rejected' || s === 'edited_approved' || s === 'expired',
  );
}

function narrowSliceLabel(filters: { status?: ReadonlyArray<string> }): string {
  if (!filters.status?.length) return 'en esa selección';
  if (filters.status.length === 1) {
    return (
      {
        approved: 'aprobadas',
        rejected: 'rechazadas',
        edited_approved: 'aprobadas con edición',
        expired: 'expiradas',
      }[filters.status[0]!] ?? 'en ese estado'
    );
  }
  return 'decididas';
}
