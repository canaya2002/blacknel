import { Clock, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface PendingApprovalBannerProps {
  approvals: ReadonlyArray<{ id: string; createdAt: Date; riskLevel: string }>;
}

/**
 * Sutil notice arriba del composer cuando hay respuestas a este thread
 * en estado pendiente / escalado en la cola de approvals. Solo cubre
 * `entity_table='inbox_messages'`; otros kinds llegarán cuando esas
 * fases (5 / 6) introduzcan sus propios approvals.
 */
export function PendingApprovalBanner({
  approvals,
}: PendingApprovalBannerProps): React.ReactElement {
  const first = approvals[0]!;
  return (
    <div className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        {approvals.length === 1
          ? 'Hay 1 respuesta pendiente de aprobación.'
          : `Hay ${approvals.length} respuestas pendientes de aprobación.`}
      </span>
      <Link
        href={`/approvals/${first.id}` as `/approvals/${string}`}
        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
      >
        Ver
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}
