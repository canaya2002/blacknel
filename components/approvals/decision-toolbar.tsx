'use client';

import { AlertCircle, ArrowUp, Check, Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  approveAction,
  escalateApprovalAction,
  rejectAction,
} from '@/app/(app)/approvals/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { EditModal } from './edit-modal';

interface DecisionToolbarProps {
  approvalId: string;
  decidable: boolean;
  proposedPayload: Record<string, unknown>;
}

export function DecisionToolbar({
  approvalId,
  decidable,
  proposedPayload,
}: DecisionToolbarProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const runFormAction = (
    action: typeof approveAction | typeof rejectAction | typeof escalateApprovalAction,
    extra?: { decisionReason?: string },
  ): void => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('approvalId', approvalId);
      if (extra?.decisionReason) fd.set('decisionReason', extra.decisionReason);
      const result = await action(null, fd);
      if (!result.ok) {
        if (result.error.code === 'APPROVAL_ALREADY_DECIDED') {
          const meta = result.error.meta as {
            decidedBy?: string | null;
            decidedAt?: string | Date | null;
          };
          const when = meta.decidedAt
            ? new Date(meta.decidedAt as string).toLocaleString()
            : 'antes';
          setError(
            `Esta aprobación ya fue decidida ${
              meta.decidedBy ? `por otro usuario` : ''
            } el ${when}. Refrescando…`,
          );
          // Best-effort: refresh the page so the user sees the new state.
          setTimeout(() => router.refresh(), 600);
          return;
        }
        setError(result.error.message);
        return;
      }
      setRejectOpen(false);
      router.refresh();
    });
  };

  if (!decidable) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-emerald-500" />
        Esta aprobación ya fue decidida.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        onClick={() => runFormAction(approveAction)}
        disabled={pending}
        data-testid="approval-approve"
      >
        <Check className="h-3.5 w-3.5" />
        Aprobar
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setEditOpen(true)}
        disabled={pending}
        data-testid="approval-edit"
      >
        <Pencil className="h-3.5 w-3.5" />
        Aprobar con edición
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setRejectOpen(true)}
        disabled={pending}
        data-testid="approval-reject"
      >
        <X className="h-3.5 w-3.5" />
        Rechazar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => runFormAction(escalateApprovalAction)}
        disabled={pending}
      >
        <ArrowUp className="h-3.5 w-3.5" />
        Escalar
      </Button>

      {error ? (
        <span className="ml-2 inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </span>
      ) : null}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar aprobación</DialogTitle>
            <DialogDescription>
              Explica por qué no se publica esta respuesta. La razón queda en
              el audit log y se le muestra al solicitante.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Motivo del rechazo (requerido)"
            className="min-h-[100px] w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none"
            maxLength={1000}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              onClick={() => runFormAction(rejectAction, { decisionReason: rejectReason.trim() })}
              disabled={pending || rejectReason.trim().length === 0}
            >
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editOpen ? (
        // Conditional mount so re-opening starts fresh from the latest
        // `proposedPayload` — avoids the setState-in-useEffect pattern
        // React 19 disallows.
        <EditModal
          open={editOpen}
          onOpenChange={setEditOpen}
          approvalId={approvalId}
          initialPayload={proposedPayload}
        />
      ) : null}
    </div>
  );
}
