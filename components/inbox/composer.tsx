'use client';

import { AlertTriangle, Loader2, Send, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { replyAction } from '@/app/(app)/inbox/[threadId]/reply-action';
import { detectLanguage } from '@/lib/inbox/detect-language';
import {
  autoFillKnownPlaceholders,
  findUnresolvedPlaceholders,
  type SubstitutionValues,
} from '@/lib/inbox/saved-reply-variables';
import type { SavedReplyOption } from '@/lib/inbox/thread-detail';

import { SavedRepliesPicker } from './saved-replies-picker';

interface ComposerProps {
  threadId: string;
  initialLanguage: string | null;
  savedReplies: ReadonlyArray<SavedReplyOption>;
  threadContext: {
    contactName: string | null;
    locationName: string | null;
    businessHours: string | null;
    phone: string | null;
    link: string | null;
  };
}

/**
 * Reply composer.
 *
 * Responsibilities:
 *
 *   - Textarea for the outbound body.
 *   - Saved-replies picker that auto-fills the placeholders we know
 *     (`{customer_name}`, `{location_name}`, `{phone}`, `{business_hours}`,
 *     `{link}`) using `autoFillKnownPlaceholders`. Unknown / unprovided
 *     placeholders stay in the body for the user to handle.
 *   - Unresolved-placeholder warning. While `findUnresolvedPlaceholders`
 *     returns anything, the Send button is disabled and a yellow strip
 *     lists what's missing. The server enforces the same check — this is
 *     just the friendly UI version.
 *   - Live language pill (`detectLanguage`) — gray when 'unknown', NOT
 *     a fallback guess.
 *   - Character counter, no hard cap — the Server Action caps at 8000.
 */
export function Composer({
  threadId,
  initialLanguage,
  savedReplies,
  threadContext,
}: ComposerProps): React.ReactElement {
  const [body, setBody] = useState('');
  const [pickedSavedReplyId, setPickedSavedReplyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<
    'idle' | 'sent' | 'routed_to_approval'
  >('idle');
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const substitutionValues: SubstitutionValues = useMemo(() => {
    const out: SubstitutionValues = {};
    if (threadContext.contactName) out.customer_name = threadContext.contactName;
    if (threadContext.locationName) out.location_name = threadContext.locationName;
    if (threadContext.phone) out.phone = threadContext.phone;
    if (threadContext.businessHours) out.business_hours = threadContext.businessHours;
    if (threadContext.link) out.link = threadContext.link;
    return out;
  }, [threadContext]);

  const unresolved = useMemo(() => findUnresolvedPlaceholders(body), [body]);

  const detected = useMemo(() => {
    // Detection seeded by the contact's known language (snapshot at
    // page load) but recomputed live from the textarea body so it
    // adapts as the user types.
    if (body.trim().length > 0) return detectLanguage(body);
    if (initialLanguage === 'es' || initialLanguage === 'en' || initialLanguage === 'pt' || initialLanguage === 'fr') {
      return initialLanguage;
    }
    return 'unknown' as const;
  }, [body, initialLanguage]);

  const charCount = body.length;

  const insertSavedReply = (option: SavedReplyOption): void => {
    const filled = autoFillKnownPlaceholders(option.body, substitutionValues);
    setBody(filled);
    setPickedSavedReplyId(option.id);
    setError(null);
    setOutcome('idle');
    queueMicrotask(() => textareaRef.current?.focus());
  };

  const canSend =
    body.trim().length > 0 && unresolved.length === 0 && !pending;

  const send = (): void => {
    if (!canSend) return;
    setError(null);
    setOutcome('idle');
    startTransition(async () => {
      const result = await replyAction(null, {
        threadId,
        messageBody: body.trim(),
        savedReplyId: pickedSavedReplyId,
        aiGenerated: false,
        language: detected,
      });
      if (result.ok) {
        setOutcome(result.data.outcome);
        setBody('');
        setPickedSavedReplyId(null);
      } else {
        if (result.error.code === 'UNRESOLVED_PLACEHOLDERS') {
          const remaining = (result.error.meta?.unresolved as string[] | undefined) ?? [];
          setError(
            `Servidor rechazó por placeholders sin resolver: ${remaining.join(', ')}.`,
          );
        } else {
          setError(result.error.message);
        }
      }
    });
  };

  return (
    <div className="border-t bg-card/30">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <SavedRepliesPicker replies={savedReplies} onPick={insertSavedReply} />
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Llega en Fase 7"
            className="gap-1"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Sugerir respuesta
          </Button>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <LanguagePill lang={detected} />
          <span data-testid="composer-charcount">{charCount}</span>
        </div>
      </div>

      {unresolved.length > 0 ? (
        <div className="flex items-start gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Placeholders sin resolver:{' '}
            {unresolved.map((u) => (
              <code key={u} className="rounded bg-amber-500/20 px-1">
                {`{${u}}`}
              </code>
            ))}
            <span className="ml-1">— reemplázalos antes de enviar.</span>
          </span>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // cmd/ctrl + enter submits — common composer convention.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSend) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Escribe tu respuesta. Usa una plantilla guardada o teclea libremente. ⌘+enter para enviar."
        className="block w-full resize-none border-0 bg-transparent px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 min-h-[120px]"
        rows={4}
        data-testid="composer-textarea"
      />

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : outcome === 'sent' ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Mensaje enviado.
          </span>
        ) : outcome === 'routed_to_approval' ? (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Compliance solicitó aprobación. Revísalo en /approvals.
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            Las respuestas con compliance flag se envían a aprobación antes de salir.
          </span>
        )}
        <Button
          size="sm"
          onClick={send}
          disabled={!canSend}
          title={
            unresolved.length > 0
              ? 'Reemplaza los placeholders marcados antes de enviar.'
              : undefined
          }
          data-testid="composer-send"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Enviar
        </Button>
      </div>
    </div>
  );
}

function LanguagePill({ lang }: { lang: string }): React.ReactElement {
  if (lang === 'unknown') {
    return (
      <Badge variant="muted" className="text-[10px] text-muted-foreground">
        Idioma no detectado
      </Badge>
    );
  }
  return (
    <Badge variant="muted" className="text-[10px] uppercase">
      {lang}
    </Badge>
  );
}
