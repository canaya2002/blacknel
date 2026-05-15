import { Star } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export default function ReviewsPage(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reviews"
        description="Reseñas de Google, Yelp, TripAdvisor, Trustpilot y otras plataformas centralizadas. Respuestas asistidas por IA, escalada automática de negativas y métricas de tiempo de respuesta."
      />
      <EmptyState
        icon={Star}
        title="Sin reseñas que mostrar todavía"
        description="Conforme conectes Google Business Profile y otras plataformas de reseñas, verás cada estrella aquí: filtros por rating, sentimiento, ubicación y plataforma; sugerencias de respuesta con la voz de tu marca; y aprobación obligatoria para reseñas negativas antes de publicar."
        primary={{
          label: 'Conectar Google Business Profile',
          disabledReason: 'Las integraciones reales llegan en la Fase 11; mocks listos desde la Fase 3',
        }}
        secondary={{
          label: 'Pedir reseñas a clientes',
          disabledReason: 'Las review requests aterrizan en la Fase 5',
        }}
      />
    </div>
  );
}
