import { Megaphone } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/common/upgrade-prompt';
import { requireUser } from '@/lib/auth/server';
import { getOrgPlanCode } from '@/lib/queries/plan';

const PLAN_RANK = { standard: 0, growth: 1, enterprise: 2 } as const;

export default async function AdsPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  const plan = await getOrgPlanCode(session);
  const gated = PLAN_RANK[plan] < PLAN_RANK.enterprise;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ads Intelligence"
        description="Métricas consolidadas de Meta, Google, TikTok, LinkedIn y X — spend, CPC, CPL, ROAS — con alertas cuando una campaña se degrada y recomendaciones de optimización."
      />
      {gated ? (
        <UpgradePrompt
          unlocksOn="enterprise"
          feature="Ads Intelligence"
          description="Conecta tus cuentas de Ads y consolida métricas, alertas y recomendaciones. Disponible en Enterprise."
        />
      ) : (
        <EmptyState
          icon={Megaphone}
          title="Conecta tus cuentas de Ads para ver el rendimiento"
          description="Vincula Meta Ads, Google Ads, TikTok Ads, LinkedIn Ads o X Ads y verás aquí el spend acumulado, el CPC y CPL por campaña, los anuncios con mejor performance y las alertas cuando un creativo se quema o el CPL excede tu umbral. Sin auto-pausa: tú decides."
          primary={{
            label: 'Conectar cuenta de Meta Ads',
            disabledReason: 'Conectores de Ads en la Fase 10 (mock) y Fase 11 (real)',
          }}
        />
      )}
    </div>
  );
}
