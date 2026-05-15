import { LayoutDashboard } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export default function DashboardPage(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Dashboard"
        description="Tu vista ejecutiva por marca: SLA del inbox, sentimiento de reseñas, calendario de publicaciones, alertas de reputación y ROI de campañas — todo en una sola pantalla."
      />
      <EmptyState
        icon={LayoutDashboard}
        title="Tu dashboard se arma cuando empieces a operar"
        description="Aquí verás cómo va cada marca: cuántas conversaciones tienes abiertas, qué reseñas necesitan respuesta, qué posts salen esta semana y qué alertas requieren tu atención. Los widgets se llenan automáticamente conforme conectes tus redes y empieces a publicar."
        primary={{
          label: 'Conectar tu primera red',
          disabledReason: 'Disponible cuando llegue Integrations Center (Fase 3)',
        }}
      />
    </div>
  );
}
