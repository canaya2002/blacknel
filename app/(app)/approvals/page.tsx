import { CheckCircle2 } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/common/upgrade-prompt';
import { requireUser } from '@/lib/auth/server';
import { getOrgPlanCode } from '@/lib/queries/plan';

const PLAN_RANK = { standard: 0, growth: 1, enterprise: 2 } as const;

export default async function ApprovalsPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  const plan = await getOrgPlanCode(session);
  const gated = PLAN_RANK[plan] < PLAN_RANK.growth;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        description="Cola de aprobaciones para respuestas sensibles, posts agendados y respuestas a reseñas. Quien aprueba ve el borrador, el contexto y los riesgos detectados por la IA antes de decidir."
      />
      {gated ? (
        <UpgradePrompt
          unlocksOn="growth"
          feature="Approvals"
          description="Las aprobaciones se desbloquean en el plan Growth — agregan revisión obligatoria a contenido sensible y respuestas con datos personales antes de que salgan al público."
        />
      ) : (
        <EmptyState
          icon={CheckCircle2}
          title="Sin aprobaciones pendientes"
          description="Cuando un agente envíe una respuesta marcada por la IA como sensible, o cuando un manager solicite revisión de un post agendado, aparecerá aquí con todo el contexto, los riesgos detectados y los botones para aprobar, editar o rechazar."
          primary={{
            label: 'Configurar reglas de aprobación',
            disabledReason: 'Disponible cuando el flujo de approvals completo aterrice en la Fase 9',
          }}
        />
      )}
    </div>
  );
}
