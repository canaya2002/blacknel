import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

/**
 * Phase 11 / Commit 40 — cost dashboard STUB.
 *
 * Full implementation lands in C43 (IA cutover) when Anthropic
 * real spend starts. C40 ships only the route + master-org gate
 * so when we wire data in C43, the surface already exists and
 * the gate is tested. See `doc/runbooks/cost-dashboard.md`
 * (created in C43).
 */
export default function CostDashboardPage(): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Cost dashboard</h1>
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 p-12 text-center">
          <p className="text-sm font-medium">Coming in C43</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Spend daily/weekly/monthly por servicio (Anthropic, Resend, R2,
            Supabase, Inngest, Sentry, PostHog). Top 10 orgs por Anthropic
            spend. Cascade rate Haiku vs Opus. Alertas visuales por threshold.
          </p>
          <p className="max-w-md text-[10px] text-muted-foreground">
            La ruta existe desde C40 + el master-org gate está testeado. C43
            cabla los datos reales.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
