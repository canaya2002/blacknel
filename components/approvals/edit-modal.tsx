'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { approveWithEditsAction } from '@/app/(app)/approvals/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface EditModalProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  approvalId: string;
  initialPayload: Record<string, unknown>;
}

/**
 * `Approve with edits` modal.
 *
 * For Phase 4, the only kind that actually flows here is `inbox_reply`
 * with a `messageBody` string. We expose a textarea bound to
 * `messageBody`; other payload keys (`threadId`, `language`, etc.)
 * pass through untouched. Future kinds (post, review_response) get
 * their own editor when Phase 5/6 ships.
 */
export function EditModal({
  open,
  onOpenChange,
  approvalId,
  initialPayload,
}: EditModalProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState<string>(
    typeof initialPayload.messageBody === 'string' ? initialPayload.messageBody : '',
  );
  const [decisionReason, setDecisionReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The modal is keyed on `open` from the parent — when it closes and
  // reopens for a different approval, React unmounts and remounts the
  // component, re-running `useState` with the fresh `initialPayload`.
  // No effect-driven sync needed (React 19 forbids that pattern).

  const submit = (): void => {
    setError(null);
    const edited = { ...initialPayload, messageBody: body };
    startTransition(async () => {
      const result = await approveWithEditsAction(null, {
        approvalId,
        editedPayload: edited,
        decisionReason: decisionReason.trim() || undefined,
      });
      if (!result.ok) {
        if (result.error.code === 'APPROVAL_ALREADY_DECIDED') {
          const meta = result.error.meta as { decidedAt?: string | Date | null };
          const when = meta.decidedAt
            ? new Date(meta.decidedAt as string).toLocaleString()
            : 'antes';
          setError(`Esta aprobación ya fue decidida el ${when}. Refrescando…`);
          setTimeout(() => router.refresh(), 600);
          return;
        }
        setError(result.error.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Aprobar con edición</DialogTitle>
          <DialogDescription>
            Ajusta el cuerpo final antes de enviar. La propuesta original
            queda guardada en el audit como diff.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Cuerpo del mensaje
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[160px] resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none"
              maxLength={8000}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Razón del edit (opcional)
            </span>
            <textarea
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              placeholder="Por qué editaste antes de aprobar"
              className="min-h-[60px] resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none"
              maxLength={1000}
            />
          </label>
          {error ? (
            <span className="text-xs text-destructive">{error}</span>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={pending || body.trim().length === 0}
            data-testid="approval-edit-submit"
          >
            Aprobar con esta edición
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
