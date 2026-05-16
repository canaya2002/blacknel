'use client';

import { Check, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import { suggestCaptionAction } from '@/app/(app)/publish/composer/[id]/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface AICaptionButtonProps {
  postId: string;
  /** Called when the user clicks "Usar este". Replaces the editor text. */
  onAccept: (caption: string) => void;
}

interface SuggestionState {
  body: string;
  variantIndex: number;
  bucket: string;
  fellBackToDefault: boolean;
}

/**
 * AI caption suggestion entry-point above the text editor.
 *
 * Flow:
 *
 *   1. Initial click → `suggestCaptionAction(postId, index=0)`.
 *   2. Preview card appears with the suggestion + 2 buttons.
 *   3. "Usar este" → `onAccept(caption)` (parent shell sets the
 *      editor text + closes the card).
 *   4. "Otra opción" → re-invoke with `index++` for the
 *      deterministic regenerate cycle (see lib/ai/caption-stub.ts).
 *
 * Server-side audit (`ai.caption.suggested` / `regenerated` /
 * `accepted`) is emitted inside the Server Action; this
 * component only orchestrates the UX.
 */
export function AICaptionButton({
  postId,
  onAccept,
}: AICaptionButtonProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const [index, setIndex] = useState<number>(0);
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestion = (nextIndex: number): void => {
    setError(null);
    startTransition(async () => {
      const result = await suggestCaptionAction(null, {
        postId,
        regenerateIndex: nextIndex,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSuggestion({
        body: result.data.body,
        variantIndex: result.data.variantIndex,
        bucket: result.data.bucket,
        fellBackToDefault: result.data.fellBackToDefault,
      });
      setIndex(nextIndex);
    });
  };

  const onClickSuggest = (): void => fetchSuggestion(0);
  const onClickRegenerate = (): void => fetchSuggestion(index + 1);
  const onClickAccept = (): void => {
    if (!suggestion) return;
    onAccept(suggestion.body);
    setSuggestion(null);
    setIndex(0);
  };
  const onClickDismiss = (): void => {
    setSuggestion(null);
    setIndex(0);
    setError(null);
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <header className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Sugerencia con IA
        </span>
        <Badge variant="muted" className="text-[10px]">
          Fase 7 → Claude Haiku
        </Badge>
      </header>

      {!suggestion ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Genera un caption inicial basado en marca, voz y campaña.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={onClickSuggest}
            disabled={pending}
            data-testid="ai-caption-suggest"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
            Sugerir caption
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="ai-caption-body">
            {suggestion.body}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              Variante {suggestion.variantIndex + 1} · {suggestion.bucket}
              {suggestion.fellBackToDefault ? ' (fallback)' : ''}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={onClickRegenerate}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                )}
                Otra opción
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onClickDismiss}
                disabled={pending}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Cerrar
              </Button>
              <Button
                size="sm"
                onClick={onClickAccept}
                disabled={pending}
                data-testid="ai-caption-accept"
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                Usar este
              </Button>
            </div>
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-[11px] text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
