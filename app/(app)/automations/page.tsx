import { Workflow } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export default function AutomationsPage(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Automations"
        description="Reglas si-esto-entonces-aquello — eleva una reseña 1★ al equipo de soporte, agradece automáticamente las 5★, asigna al especialista correcto según la marca, dispara un alerta cuando una mención se vuelve viral."
      />
      <EmptyState
        icon={Workflow}
        title="Aún no tienes automatizaciones"
        description="Crea reglas con triggers (reseña nueva, mensaje entrante, mención de keyword, score NPS) y acciones (asignar, etiquetar, responder con plantilla, notificar a Slack, escalar a humano). Cada disparo queda en el audit log para que sepas qué pasó y por qué."
        primary={{
          label: 'Crear automatización',
          disabledReason: 'El motor de automatizaciones llega en la Fase 9',
        }}
      />
    </div>
  );
}
