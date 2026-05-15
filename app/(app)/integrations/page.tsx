import { Plug } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export default function IntegrationsPage(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Integrations"
        description="Centro de conexiones — Facebook, Instagram, Google Business Profile, WhatsApp, TikTok, LinkedIn, X, YouTube, Pinterest, Reddit, Yelp, TripAdvisor y más. Estado, capacidades por plataforma, errores y reconexión asistida."
      />
      <EmptyState
        icon={Plug}
        title="Aún no has conectado ningún canal"
        description="Cada integración expone sus capacidades reales (publicar, responder DMs, leer reseñas, ver insights, mandar reviews requests). Blacknel respeta lo que cada API permite — Yelp solo deja leer reseñas, por ejemplo, así que esa capacidad aparece marcada y el botón de respuesta se oculta de forma coherente."
        primary={{
          label: 'Conectar Facebook',
          disabledReason: 'Integrations Center con 16 conectores mock aterriza en la Fase 3',
        }}
        secondary={{
          label: 'Conectar Google Business Profile',
          disabledReason: 'Mocks en Fase 3, OAuth real en Fase 11',
        }}
      />
    </div>
  );
}
