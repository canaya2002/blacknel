import { Award } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export default function ReputationPage(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reputation"
        description="Rating promedio por ubicación y plataforma, evolución temporal, temas frecuentes extraídos por IA, comparativa entre sucursales y alertas cuando la reputación cae."
      />
      <EmptyState
        icon={Award}
        title="El score de reputación necesita reseñas"
        description="Cuando empiecen a entrar reseñas, aquí tendrás el rating consolidado por ubicación, el desglose por plataforma, los temas que más se repiten (servicio, comida, ambiente, tiempos…) y un radar de caídas de reputación que aprende del histórico de cada marca."
        primary={{
          label: 'Ver tendencias',
          disabledReason: 'Disponible cuando reseñas y reputación aterricen en la Fase 5',
        }}
      />
    </div>
  );
}
