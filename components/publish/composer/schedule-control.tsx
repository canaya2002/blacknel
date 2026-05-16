'use client';

import { Calendar, Clock, FileText, Send } from 'lucide-react';
import { useTransition } from 'react';

import { setScheduledAtAction } from '@/app/(app)/publish/composer/[id]/actions';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import {
  formatScheduledForDisplay,
  localToUtc,
  timezoneShortLabel,
  utcToLocalParts,
  validateScheduledAt,
} from '@/lib/publish/composer/schedule';

export type ScheduleMode = 'draft' | 'now' | 'schedule';

interface ScheduleControlProps {
  postId: string;
  /** Current persisted scheduled_at (UTC). */
  scheduledAtUtc: Date | null;
  /** Current selected mode (controlled by parent shell). */
  mode: ScheduleMode;
  onModeChange: (next: ScheduleMode) => void;
  /** IANA timezone for the date/time inputs. */
  timeZone: string;
  /** BCP-47 locale for the display label. */
  locale: string;
  /** "Now" reference, drives validation. Defaults to a fresh Date on render. */
  now?: Date;
  /** Notify parent when the persisted scheduled_at changes. */
  onScheduledAtChange: (next: Date | null) => void;
}

/**
 * Schedule selector for the composer (Commit 19c.2).
 *
 * 3 modes:
 *
 *   - **Borrador** — `scheduled_at = null`, status stays draft.
 *     The post sleeps until the user explicitly publishes / schedules.
 *   - **Publicar ahora** — `scheduled_at = null`, the
 *     `schedulePostAction` transitions the post directly to
 *     `published` (Commit 20 publish-job handles real platforms).
 *   - **Programar para más tarde** — date + time inputs in the
 *     org's timezone; persists as UTC via `setScheduledAtAction`.
 *
 * Validation runs locally before the action call (so error
 * states surface inline without a roundtrip), and the Server
 * Action repeats the same `validateScheduledAt` defensively.
 */
export function ScheduleControl({
  postId,
  scheduledAtUtc,
  mode,
  onModeChange,
  timeZone,
  locale,
  now,
  onScheduledAtChange,
}: ScheduleControlProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const effectiveNow = now ?? new Date();
  const parts = scheduledAtUtc ? utcToLocalParts(scheduledAtUtc, timeZone) : { date: '', time: '' };
  const tzLabel = timezoneShortLabel(effectiveNow, timeZone, locale);

  const persistScheduledAt = (next: Date | null): void => {
    startTransition(async () => {
      const result = await setScheduledAtAction(null, {
        postId,
        scheduledAtIso: next?.toISOString() ?? null,
      });
      if (result.ok) {
        onScheduledAtChange(
          result.data.scheduledAtIso ? new Date(result.data.scheduledAtIso) : null,
        );
      }
    });
  };

  const onModeRadioChange = (next: ScheduleMode): void => {
    onModeChange(next);
    if (next === 'draft' || next === 'now') {
      if (scheduledAtUtc !== null) {
        persistScheduledAt(null);
      }
    }
  };

  const onDateOrTimeChange = (
    nextDate: string,
    nextTime: string,
  ): void => {
    const iso = `${nextDate}T${nextTime || '00:00'}`;
    const utc = localToUtc(iso, timeZone);
    if (Number.isNaN(utc.getTime())) return;
    persistScheduledAt(utc);
  };

  // Validation for the "Programar" branch. Only computed when the
  // user is on that mode AND has filled both fields.
  const validation =
    mode === 'schedule' && scheduledAtUtc !== null
      ? validateScheduledAt(scheduledAtUtc, effectiveNow)
      : null;
  const validationError =
    validation && !validation.ok ? validation.error : null;

  const displayLabel =
    mode === 'schedule' && scheduledAtUtc && validation?.ok
      ? formatScheduledForDisplay(scheduledAtUtc, timeZone, locale)
      : null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Calendar className="h-3.5 w-3.5" aria-hidden />
          Programación
        </span>
        <Badge variant="muted" className="text-[10px]">
          {tzLabel}
        </Badge>
      </header>

      <fieldset
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        aria-label="Modo de publicación"
      >
        <ModeRadio
          mode="draft"
          current={mode}
          onChange={onModeRadioChange}
          icon={<FileText className="h-4 w-4" aria-hidden />}
          label="Borrador"
          description="Sin programar"
        />
        <ModeRadio
          mode="now"
          current={mode}
          onChange={onModeRadioChange}
          icon={<Send className="h-4 w-4" aria-hidden />}
          label="Publicar ahora"
          description="Al guardar"
        />
        <ModeRadio
          mode="schedule"
          current={mode}
          onChange={onModeRadioChange}
          icon={<Clock className="h-4 w-4" aria-hidden />}
          label="Programar"
          description="Fecha y hora"
        />
      </fieldset>

      {mode === 'schedule' ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="font-medium text-muted-foreground">Fecha</span>
              <Input
                type="date"
                value={parts.date}
                onChange={(e) => onDateOrTimeChange(e.target.value, parts.time)}
                className="h-8 text-xs"
                disabled={pending}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="font-medium text-muted-foreground">Hora</span>
              <Input
                type="time"
                step={300}
                value={parts.time}
                onChange={(e) => onDateOrTimeChange(parts.date, e.target.value)}
                className="h-8 text-xs"
                disabled={pending}
              />
            </label>
          </div>

          {validationError ? (
            <p
              role="alert"
              className="text-[11px] text-red-600"
              data-testid="schedule-validation-error"
            >
              {validationError.message}
            </p>
          ) : displayLabel ? (
            <p
              className="text-[11px] text-muted-foreground"
              data-testid="schedule-confirmation"
            >
              Se publicará el{' '}
              <span className="font-medium text-foreground">{displayLabel}</span>.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Elige fecha y hora en {tzLabel}.
            </p>
          )}
        </div>
      ) : (
        <p
          className={cn(
            'rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground',
          )}
        >
          {mode === 'draft'
            ? 'El post se guarda como borrador. Lo puedes publicar o programar después.'
            : 'Al guardar, el post se publicará inmediatamente. (La cuota mensual del plan aplica.)'}
        </p>
      )}
    </section>
  );
}

function ModeRadio({
  mode,
  current,
  onChange,
  icon,
  label,
  description,
}: {
  mode: ScheduleMode;
  current: ScheduleMode;
  onChange: (next: ScheduleMode) => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}): React.ReactElement {
  const active = mode === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onChange(mode)}
      className={cn(
        'flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-xs transition-colors',
        active
          ? 'border-foreground/40 bg-muted'
          : 'border-transparent hover:bg-muted/40',
      )}
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        {icon}
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground">{description}</span>
    </button>
  );
}
