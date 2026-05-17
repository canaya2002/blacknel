'use client';

import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

import { submitNpsResponseAction } from './submit-action';

interface NpsResponseFormProps {
  token: string;
  locale: 'es' | 'en';
  questionText: string;
  contactName: string | null;
  thankYouMessage: string | null;
}

interface Copy {
  scaleLeft: string;
  scaleRight: string;
  commentLabel: string;
  commentLabelRequired: string;
  commentPlaceholder: string;
  submit: string;
  submitting: string;
  thanksDefault: string;
  errorGeneric: string;
  errorRate: string;
  errorNotFound: string;
  errorDetractorComment: string;
  pickPrompt: string;
}

const COPY: Record<'es' | 'en', Copy> = {
  es: {
    scaleLeft: 'Nada probable',
    scaleRight: 'Muy probable',
    commentLabel: '¿Qué nos quieres contar? (opcional)',
    commentLabelRequired: '¿Qué podemos mejorar?',
    commentPlaceholder: 'Lo que más te gustó, lo que podemos mejorar…',
    submit: 'Enviar',
    submitting: 'Enviando…',
    thanksDefault: '¡Gracias por tu feedback!',
    errorGeneric: 'No pudimos procesar tu envío. Intenta de nuevo.',
    errorRate:
      'Demasiados intentos en poco tiempo. Espera un momento e intenta de nuevo.',
    errorNotFound:
      'Este enlace ya no es válido. Si tienes una duda, contáctanos directamente.',
    errorDetractorComment:
      'Por favor cuéntanos qué podemos mejorar — tu comentario nos ayuda mucho.',
    pickPrompt: 'Elige una puntuación del 0 al 10.',
  },
  en: {
    scaleLeft: 'Not at all likely',
    scaleRight: 'Extremely likely',
    commentLabel: 'Want to tell us more? (optional)',
    commentLabelRequired: 'What can we improve?',
    commentPlaceholder: 'What you enjoyed, what we can improve…',
    submit: 'Submit',
    submitting: 'Sending…',
    thanksDefault: 'Thanks for your feedback!',
    errorGeneric: "We couldn't process your submission. Try again.",
    errorRate: 'Too many attempts. Wait a moment and try again.',
    errorNotFound: 'This link is no longer valid. Reach out directly if you have a question.',
    errorDetractorComment:
      'Please tell us what we can improve — your comment really helps.',
    pickPrompt: 'Pick a score from 0 to 10.',
  },
};

export function NpsResponseForm({
  token,
  locale,
  questionText,
  contactName,
  thankYouMessage,
}: NpsResponseFormProps): React.ReactElement {
  const copy = COPY[locale];
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{
    category: 'promoter' | 'passive' | 'detractor';
    thankYouMessage: string | null;
  } | null>(null);

  const isDetractor = score !== null && score <= 6;
  const commentRequired = isDetractor;
  const canSubmit =
    score !== null &&
    (!commentRequired || comment.trim().length > 0);

  const submit = (): void => {
    if (score === null) return;
    setError(null);
    if (commentRequired && comment.trim().length === 0) {
      setError(copy.errorDetractorComment);
      return;
    }
    startTransition(async () => {
      const result = await submitNpsResponseAction(null, {
        token,
        score,
        comment: comment.trim().length > 0 ? comment.trim() : undefined,
      });
      if (result.ok) {
        setSubmitted(result.data);
      } else if (result.error.code === 'RATE_LIMITED') {
        setError(copy.errorRate);
      } else if (result.error.code === 'NOT_FOUND') {
        setError(copy.errorNotFound);
      } else if (result.error.code === 'VALIDATION_ERROR') {
        setError(copy.errorDetractorComment);
      } else {
        setError(copy.errorGeneric);
      }
    });
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-start gap-4 py-8 text-left">
        <h1 className="text-3xl font-semibold leading-tight">
          {locale === 'es' ? '¡Gracias!' : 'Thanks!'}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {submitted.thankYouMessage ?? thankYouMessage ?? copy.thanksDefault}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold leading-tight">
          {contactName ? `${greeting(locale, contactName)}, ` : ''}
          {questionText}
        </h2>
      </div>

      <div
        className="flex flex-col gap-2"
        role="radiogroup"
        aria-label={copy.pickPrompt}
      >
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={score === n}
              aria-label={`${n}`}
              data-testid={`nps-score-${n}`}
              onClick={() => setScore(n)}
              className={cn(
                'flex aspect-square items-center justify-center rounded-md border text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                score === n
                  ? bucketSelectedClass(n)
                  : bucketIdleClass(n),
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{copy.scaleLeft}</span>
          <span>{copy.scaleRight}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="nps-comment"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          {commentRequired ? copy.commentLabelRequired : copy.commentLabel}
          {commentRequired ? <span aria-hidden> *</span> : null}
        </label>
        <textarea
          id="nps-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder={copy.commentPlaceholder}
          className="rounded-md border bg-background px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Button
        onClick={submit}
        disabled={pending || !canSubmit}
        size="lg"
        className="self-stretch sm:self-start"
        data-testid="nps-submit"
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {copy.submitting}
          </>
        ) : (
          copy.submit
        )}
      </Button>
    </div>
  );
}

function bucketSelectedClass(n: number): string {
  if (n >= 9)
    return 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700';
  if (n >= 7)
    return 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600';
  return 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700';
}

function bucketIdleClass(n: number): string {
  if (n >= 9)
    return 'border-zinc-200 text-zinc-700 hover:border-emerald-500 hover:bg-emerald-50 dark:border-zinc-700 dark:text-zinc-200';
  if (n >= 7)
    return 'border-zinc-200 text-zinc-700 hover:border-amber-500 hover:bg-amber-50 dark:border-zinc-700 dark:text-zinc-200';
  return 'border-zinc-200 text-zinc-700 hover:border-rose-500 hover:bg-rose-50 dark:border-zinc-700 dark:text-zinc-200';
}

function greeting(locale: 'es' | 'en', name: string): string {
  const first = name.split(/\s+/u)[0] ?? name;
  return locale === 'es' ? `Hola ${first}` : `Hi ${first}`;
}
