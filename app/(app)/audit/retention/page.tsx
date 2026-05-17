import Link from 'next/link';
import { notFound } from 'next/navigation';

import { listRetentionPolicies } from '@/lib/audit-advanced/queries';
import { RetentionPolicyForm } from '@/components/audit/retention-policy-form';
import { PageHeader } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getPlan } from '@/lib/plans/plans';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

export default async function AuditRetentionPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'audit:read');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'audit_advanced')) {
    notFound();
  }

  const policies = await listRetentionPolicies({
    orgId: session.orgId,
    userId: session.userId,
  });

  const cap = getPlan(plan).limits.auditRetentionDaysMax;
  const capLabel = cap < 0 ? 'ilimitado' : `${cap} días`;

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Audit retention"
        description={`Política por organización. Sin policies, los audit events nunca se purgan. Plan ${plan}: retention máximo ${capLabel}.`}
        eyebrow={
          <Link href="/audit" className="hover:underline">
            ← Volver a Audit
          </Link>
        }
      />
      <Card className="p-3 text-xs text-muted-foreground" data-testid="retention-precedence-note">
        <strong>Precedence rule:</strong> exact match &gt; prefix
        (<code className="font-mono">x.*</code>) &gt;{' '}
        <code className="font-mono">all</code>. Empate por specificity →
        mayor retention gana (defense in depth).
      </Card>
      <RetentionPolicyForm
        policies={policies.map((p) => ({
          id: p.id,
          appliesTo: p.appliesTo,
          retentionDays: p.retentionDays,
        }))}
      />
    </div>
  );
}
