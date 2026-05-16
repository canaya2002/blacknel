'use client';

import {
  AlertTriangle,
  ClipboardEdit,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import { respondToReviewAction } from '@/app/(app)/reviews/[reviewId]/response-action';
import { suggestResponseAction } from '@/app/(app)/reviews/[reviewId]/suggest-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ResponseComposerProps {
  reviewId: string;
  /** Drives the AI-suggest bucket and the composer header copy. */
  rating: number;
  /**
   * `false` when the platform connector doesn't declare `reply_reviews`
   * (Yelp). In that case the composer renders a read-only notice
   * instead of a textarea.
   */
  canReply: boolean;
}

/**
 * Composer for review responses. Same composition as
 * `components/inbox/composer.tsx` (Commit 9), trimmed to the review
 * surface needs:
 *
 *   - No saved-replies picker (review responses are short-form; the
 *     "Sugerir respuesta" button is the prompt-generator equivalent).
 *   - No `findUnresolvedPlaceholders` — `suggestReviewResponse` falls
 *     back to a variant with no placeholders when context is missing,
 *     so the suggestion text is always fully resolved.
 *   - "Guardar borrador" + "Enviar" buttons map to the two `mode`
 *     branches of the server orchestrator.
 *   - For `rating <= 3` we surface an info notice up-front: "Las
 *     respuestas a reseñas ≤3★ pasan por aprobación antes de
 *     publicarse" so the routing is never a surprise.
 *
 * Idempotency: `randomUUID()` per click. A retry after a network
 * blip lands on the same key so the partial-unique index on
 * `(review_id, idempotency_key)` rejects the double-send. The server
 * surfaces that as `CONFLICT` which the composer shows as a friendly
 * error rather than a generic 500.
 */
export function ResponseComposer({
  reviewId,
  rating,
  canReply,
}: ResponseComposerProps): React.ReactElement {
  const [body, setBody] = useState('');
  const [aiGenerated, setAiGenerated] = useState(false);
  const [outcome, setOutcome] = useState<
    'idle' | 'drafted' | 'sent' | 'routed_to_approval'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingSend, startSend] = useTransition();
  const [pendingDraft, startDraft] = useTransition();
  const [pendingSuggest, startSuggest] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!canReply) {
    return (
      <div className="border-t bg-card/40 px-4 py-4 text-xs text-muted-foreground">
        Esta plataforma no permite responder reseñas desde Blacknel
        (capability <code>reply_reviews</code> ausente). Abre el dashboard
        oficial de la plataforma para responder.
      </div>
    );
  }

  const sendBody = (mode: 'send' | 'draft'): void => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    setError(null);
    setOutcome('idle');
    const runner = mode === 'send' ? startSend : startDraft;
    runner(async () => {
      const idempotencyKey = mode === 'send' ? crypto.randomUUID() : undefined;
      const input = {
        reviewId,
        body: trimmed,
        mode,
        aiGenerated,
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      };
      const result = await respondToReviewAction(null, input);
      if (result.ok) {
        setOutcome(result.data.outcome);
        setBody('');
        setAiGenerated(false);
      } else if (result.error.code === 'CONFLICT') {
        setError('Esta respuesta ya fue enviada en un intento previo.');
      } else if (result.error.code === 'CAPABILITY_NOT_AVAILABLE') {
        setError('Esta plataforma no permite responder reseñas.');
      } else {
        setError(result.error.message);
      }
    });
  };

  const suggest = (): void => {
    setError(null);
    startSuggest(async () => {
      const result = await suggestResponseAction(null, { reviewId });
      if (result.ok) {
        setBody(result.data.body);
        setAiGenerated(true);
        setOutcome('idle');
        queueMicrotask(() => textareaRef.current?.focus());
      } else {
        setError(result.error.message);
      }
    });
  };

  const charCount = body.length;
  const lowRating = rating <= 3;
  const canSubmit =
    body.trim().length > 0 && !pendingSend && !pendingDraft;

  return (
    <div className="border-t bg-card/30">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={suggest}
            disabled={pendingSuggest}
            className="gap-1.5"
          >
            {pendingSuggest ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Sugerir respuesta
          </Button>
          {aiGenerated ? (
            <Badge variant="muted" className="text-[10px]">
              IA
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span data-testid="response-charcount">{charCount}</span>
          <span>/ 4000</span>
        </div>
      </div>

      {lowRating ? (
        <div className="flex items-start gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Reseñas de {rating}★ pasan por aprobación antes de publicarse.
            Verás la respuesta en /approvals para que un manager la apruebe.
          </span>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          // Manual edits remove the IA badge — what gets sent is
          // a human's text, even if it started as a suggestion.
          if (aiGenerated) setAiGenerated(false);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
            e.preventDefault();
            sendBody('send');
          }
        }}
        placeholder="Escribe tu respuesta o usa la sugerencia de IA. ⌘+enter para enviar."
        className="block min-h-[120px] w-full resize-none border-0 bg-transparent px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70"
        rows={4}
        data-testid="response-composer-textarea"
      />

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : outcome === 'drafted' ? (
          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            Borrador guardado.
          </span>
        ) : outcome === 'sent' ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Respuesta publicada.
          </span>
        ) : outcome === 'routed_to_approval' ? (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Enviada a aprobación.
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            Las respuestas con rating ≤3★ o flags de compliance pasan por aprobación.
          </span>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendBody('draft')}
            disabled={!canSubmit}
            title="Guardar como borrador sin publicar."
            data-testid="response-composer-draft"
          >
            {pendingDraft ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ClipboardEdit className="h-3.5 w-3.5" />
            )}
            Guardar borrador
          </Button>
          <Button
            size="sm"
            onClick={() => sendBody('send')}
            disabled={!canSubmit}
            data-testid="response-composer-send"
          >
            {pendingSend ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}
