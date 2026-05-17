'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createNpsSurveyAction,
  updateNpsSurveyAction,
} from '@/app/(app)/nps/actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { NpsSurveyRow } from '@/lib/nps/queries';

interface SurveyFormProps {
  mode: 'create' | 'edit';
  initial?: NpsSurveyRow;
}

const CHANNELS = ['email', 'whatsapp'] as const;
type Trigger = 'post_resolution' | 'manual' | 'post_purchase' | 'periodic';
type Status = 'draft' | 'active' | 'paused';

/**
 * Create / edit form for a `nps_surveys` row (Phase 9 / Commit 32).
 *
 * Single component reused by `/nps/surveys/new` and
 * `/nps/surveys/[id]/edit`. The Server Action distinguishes the two
 * via the `mode` prop. Validation duplicates the Zod schema
 * client-side (loosely) so the UI catches obvious mistakes before
 * the round-trip.
 *
 * `sms_reserved` channel is hidden — Phase 11 surfaces it once the
 * connector lands.
 */
export function NpsSurveyForm({
  mode,
  initial,
}: SurveyFormProps): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? '');
  const [questionText, setQuestionText] = useState(
    initial?.questionText ??
      '¿Qué tan probable es que recomiendes nuestra marca a un amigo o colega?',
  );
  const [thankYouMessage, setThankYouMessage] = useState(
    initial?.thankYouMessage ?? '¡Gracias por tu feedback!',
  );
  const [locale, setLocale] = useState<'es' | 'en'>(
    initial?.locale === 'en' ? 'en' : 'es',
  );
  const [trigger, setTrigger] = useState<Trigger>(
    (initial?.trigger as Trigger) ?? 'post_resolution',
  );
  const [status, setStatus] = useState<Status>(
    (initial?.status as Status) ?? 'draft',
  );
  const [channels, setChannels] = useState<ReadonlyArray<'email' | 'whatsapp'>>(
    (initial?.channels as ReadonlyArray<'email' | 'whatsapp'>) ?? ['email'],
  );
  const [minDays, setMinDays] = useState(initial?.minDaysBetweenSends ?? 90);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggleChannel = (c: 'email' | 'whatsapp'): void => {
    setChannels((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const submit = (): void => {
    if (channels.length === 0) {
      setError('Selecciona al menos un canal.');
      return;
    }
    if (name.trim().length === 0) {
      setError('Dale un nombre al survey.');
      return;
    }
    if (questionText.trim().length === 0) {
      setError('Escribe la pregunta del survey.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const payload = {
        ...(initial?.id ? { id: initial.id } : {}),
        ...(initial?.brandId ? { brandId: initial.brandId } : {}),
        name: name.trim(),
        questionText: questionText.trim(),
        thankYouMessage: thankYouMessage.trim() || null,
        locale,
        trigger,
        status,
        channels,
        minDaysBetweenSends: minDays,
      };
      const result =
        mode === 'create'
          ? await createNpsSurveyAction(null, payload)
          : await updateNpsSurveyAction(null, payload);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(`/nps/surveys/${result.data.surveyId}`);
    });
  };

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Nombre
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-testid="nps-form-name"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Pregunta
        </label>
        <textarea
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          rows={3}
          maxLength={500}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-testid="nps-form-question"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Mensaje de agradecimiento
        </label>
        <textarea
          value={thankYouMessage}
          onChange={(e) => setThankYouMessage(e.target.value)}
          rows={2}
          maxLength={500}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Idioma
          </label>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as 'es' | 'en')}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Trigger
          </label>
          <select
            value={trigger}
            onChange={(e) =>
              setTrigger(e.target.value as Trigger)
            }
            className="rounded-md border bg-background px-3 py-2 text-sm"
            data-testid="nps-form-trigger"
          >
            <option value="post_resolution">Post resolución (auto)</option>
            <option value="manual">Manual</option>
            <option value="post_purchase">Post compra (Fase 10+)</option>
            <option value="periodic">Periódico (Fase 10+)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Estado
          </label>
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as Status)
            }
            className="rounded-md border bg-background px-3 py-2 text-sm"
            data-testid="nps-form-status"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Mínimo días entre envíos
          </label>
          <input
            type="number"
            min={0}
            max={365}
            value={minDays}
            onChange={(e) => setMinDays(Number(e.target.value))}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Canales
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleChannel(c)}
              data-testid={`nps-form-channel-${c}`}
              className={
                channels.includes(c)
                  ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
                  : 'rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/40'
              }
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={pending} data-testid="nps-form-submit">
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Guardando…
            </>
          ) : mode === 'create' ? (
            'Crear survey'
          ) : (
            'Guardar cambios'
          )}
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}
