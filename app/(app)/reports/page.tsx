import { BarChart3 } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export default function ReportsPage(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reports"
        description="Dashboards ejecutivos, reportes de inbox, reseñas, publishing y SLA. Export a CSV y PDF, envío programado a stakeholders y explicaciones de spikes generadas por IA."
      />
      <EmptyState
        icon={BarChart3}
        title="Aún no hay datos suficientes para reportar"
        description="Una vez que el inbox, reseñas y publishing tengan actividad, esta pantalla mostrará dashboards con rango de fechas configurable, comparativas entre marcas y ubicaciones, distribución de sentimiento, tiempos de respuesta y export a PDF con tu branding. Los reportes ejecutivos se envían por email automáticamente."
        primary={{
          label: 'Configurar primer reporte',
          disabledReason: 'Los reportes llegan en la Fase 8',
        }}
      />
    </div>
  );
}
