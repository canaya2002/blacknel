import { Sparkles } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export default function AIStudioPage(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="AI Studio"
        description="Generación de contenido con la voz de tu marca, ideas de campañas, scripts de video y reciclaje desde reseñas o menciones. Cada salida pasa por compliance check antes de poder publicarse."
      />
      <EmptyState
        icon={Sparkles}
        title="Tu copiloto creativo te espera"
        description="Aquí pedirás captions adaptados por red, ideas semanales basadas en tu calendario, hilos a partir de reseñas top y traducciones por idioma — siempre con la brand voice activa y el filtro de cumplimiento antes de ir al composer."
        primary={{
          label: 'Configurar brand voice',
          disabledReason: 'La voz de marca y el AI Studio aterrizan en la Fase 7',
        }}
      />
    </div>
  );
}
