import { Inbox } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export default function InboxPage(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Inbox"
        description="Mensajes directos, comentarios y menciones de todas tus redes en una sola bandeja. Asigna a tu equipo, responde con IA con guardrails, cierra cuando esté resuelto."
      />
      <EmptyState
        icon={Inbox}
        title="Aún no hay conversaciones que mostrar"
        description="Aquí verás los mensajes y comentarios de Facebook, Instagram, WhatsApp, TikTok y demás canales conectados — ordenados por urgencia, sentimiento y ubicación. Plantillas guardadas, asignación al equipo y sugerencias de respuesta con IA cuando lleguen los primeros hilos."
        primary={{
          label: 'Conectar canales',
          disabledReason: 'Disponible cuando llegue Integrations Center (Fase 3)',
        }}
        secondary={{
          label: 'Configurar plantillas',
          disabledReason: 'El inbox unificado llega en la Fase 4',
        }}
      />
    </div>
  );
}
