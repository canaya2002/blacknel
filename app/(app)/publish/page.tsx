import { Send } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export default function PublishPage(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Publish"
        description="Composer multi-red con previews por plataforma, calendario mensual y semanal, biblioteca de assets, agrupación en campañas y agendado con timezone correcto."
      />
      <EmptyState
        icon={Send}
        title="Aquí construirás tu calendario de contenido"
        description="Crea un post una sola vez y publícalo en Facebook, Instagram, GBP, TikTok, LinkedIn o cualquier red conectada con variantes de texto por canal, sugerencias de horario, hashtags propuestos por IA y aprobación previa cuando aplique. Los borradores, posts agendados y publicados viven aquí."
        primary={{
          label: 'Crear primer post',
          disabledReason: 'El composer multi-red llega en la Fase 6',
        }}
        secondary={{
          label: 'Importar plantilla',
          disabledReason: 'Disponible junto al composer en la Fase 6',
        }}
      />
    </div>
  );
}
