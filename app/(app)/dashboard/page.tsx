import { cookies } from 'next/headers';
import { LayoutDashboard } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { requireUser } from '@/lib/auth/server';
import { getChecklist } from '@/lib/queries/checklist';

const CHECKLIST_DISMISS_COOKIE = 'blacknel_checklist_dismissed';

export default async function DashboardPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  const [checklist, cookieStore] = await Promise.all([getChecklist(session), cookies()]);
  const dismissed = cookieStore.get(CHECKLIST_DISMISS_COOKIE)?.value === '1';
  const showChecklist = !checklist.isComplete && !dismissed;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Tu vista ejecutiva por marca: SLA del inbox, sentimiento de reseñas, calendario de publicaciones, alertas de reputación y ROI de campañas — todo en una sola pantalla."
      />
      {showChecklist ? (
        <OnboardingChecklist
          items={checklist.items}
          doneCount={checklist.doneCount}
          total={checklist.total}
          initiallyDismissed={false}
        />
      ) : null}
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
