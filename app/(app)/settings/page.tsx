import { Settings } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export default function SettingsPage(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Settings"
        description="Datos de la organización, locale por defecto, timezone, idiomas habilitados para IA, preferencias de notificaciones y configuración de brand voice por marca."
      />
      <EmptyState
        icon={Settings}
        title="Configuración por venir"
        description="Esta pantalla acumulará en las próximas fases todo lo que es específico a tu workspace: datos legales y fiscales, branding, idiomas, horarios laborales para SLA, voz de marca por cada brand, preferencias de notificaciones por usuario y políticas de retención."
        primary={{
          label: 'Editar datos de la organización',
          disabledReason: 'El CRUD de settings aterriza en la Fase 2',
        }}
      />
    </div>
  );
}
