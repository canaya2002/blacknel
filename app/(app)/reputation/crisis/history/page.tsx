import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { CrisisHistoryList } from '@/components/reputation/crisis-history-list';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { listCrisisRecommendations } from '@/lib/ai/recommendations';
import { authorize } from '@/lib/permissions/can';

export const dynamic = 'force-dynamic';

const HISTORY_LOOKBACK_DAYS = 90;

/**
 * /reputation/crisis/history — Commit 25 (Ajuste 2).
 *
 * Lists accepted + dismissed crisis recommendations from the
 * last 90 days. Banner on /reputation shows only pending; this
 * surface answers "qué crisis hubo, qué decidimos, quién decidió".
 *
 * Gated by `crisis:read` (which every reputation-reading role
 * carries — manager / admin / owner / viewer / agent).
 */
export default async function CrisisHistoryPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'crisis:read');

  const now = new Date();
  const since = new Date(now.getTime() - HISTORY_LOOKBACK_DAYS * 86_400_000);

  const recs = await listCrisisRecommendations({
    orgId: session.orgId,
    userId: session.userId,
    status: ['accepted', 'dismissed'],
    since,
    limit: 50,
  });

  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-3 border-b bg-card/30 px-6 py-3">
        <Button asChild size="icon" variant="ghost" className="h-8 w-8">
          <Link
            href="/reputation"
            prefetch={false}
            aria-label="Volver a reputation"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <div className="flex flex-col">
          <h1 className="text-base font-semibold tracking-tight">
            Historial de crisis
          </h1>
          <p className="text-xs text-muted-foreground">
            Alertas de crisis aceptadas o descartadas en los últimos{' '}
            {HISTORY_LOOKBACK_DAYS} días. Cada fila muestra severidad,
            evidencia, quién decidió y por qué.
          </p>
        </div>
      </header>

      <div className="px-6 py-4">
        <CrisisHistoryList recommendations={recs} />
      </div>
    </div>
  );
}
