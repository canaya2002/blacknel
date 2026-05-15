import { ScrollText } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/common/upgrade-prompt';
import { requireUser } from '@/lib/auth/server';
import { getOrgPlanCode } from '@/lib/queries/plan';

const PLAN_RANK = { standard: 0, growth: 1, enterprise: 2 } as const;

export default async function AuditPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  const plan = await getOrgPlanCode(session);
  const gated = PLAN_RANK[plan] < PLAN_RANK.growth;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit"
        description="Registro append-only de todo lo que ocurre — quién hizo qué, sobre qué entidad, con qué cambio. Útil para investigar incidentes, demostrar cumplimiento y entender por qué algo pasó."
      />
      {gated ? (
        <UpgradePrompt
          unlocksOn="growth"
          feature="Audit log"
          description="Auditoría básica en Growth (filtros, búsqueda); diff before/after y export en Enterprise."
        />
      ) : (
        <EmptyState
          icon={ScrollText}
          title="Sin eventos auditados todavía"
          description="Cada acción de un usuario, IA, sistema o automatización queda registrada aquí con timestamp, IP, usuario y diff before/after. Filtra por entidad, actor, rango de fechas o nivel de riesgo. La pantalla se llena conforme empieces a operar."
          primary={{
            label: 'Exportar log',
            disabledReason: 'Auditoría completa con export aterriza en la Fase 10',
          }}
        />
      )}
    </div>
  );
}
