'use client';

import { Loader2, Star } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

import { submitFeedbackAction } from './submit-action';

interface FeedbackFormProps {
  token: string;
  locale: 'es' | 'en';
  brandName: string | null;
  locationName: string | null;
  contactName: string | null;
  publicReviewUrl: string | null;
}

interface Copy {
  prompt: string;
  commentLabel: string;
  commentPlaceholder: string;
  submit: string;
  submitting: string;
  ratingLabel: (n: number) => string;
  thanksPositiveTitle: string;
  thanksPositiveBody: string;
  thanksPositiveCta: string;
  thanksNegativeTitle: string;
  thanksNegativeBody: string;
  errorGeneric: string;
  errorRate: string;
  errorNotFound: string;
}

const COPY: Record<'es' | 'en', Copy> = {
  es: {
    prompt: '¿Cómo fue tu experiencia?',
    commentLabel: 'Cuéntanos más (opcional)',
    commentPlaceholder: 'Lo que más te gustó, lo que podemos mejorar…',
    submit: 'Enviar feedback',
    submitting: 'Enviando…',
    ratingLabel: (n: number) => `${n} de 5 estrellas`,
    thanksPositiveTitle: '¡Gracias!',
    thanksPositiveBody:
      'Nos alegra que tu experiencia haya sido positiva. Si tienes un minuto, ayúdanos compartiéndola en público.',
    thanksPositiveCta: 'Dejar reseña pública',
    thanksNegativeTitle: 'Gracias por contarnos.',
    thanksNegativeBody:
      'Lamentamos no haber cumplido tus expectativas. Un manager te contactará en las próximas 24 horas para resolverlo.',
    errorGeneric: 'No pudimos procesar tu envío. Intenta de nuevo.',
    errorRate: 'Demasiados intentos en poco tiempo. Espera un momento e intenta de nuevo.',
    errorNotFound: 'Este enlace ya no es válido. Si tienes una duda, contáctanos directamente.',
  },
  en: {
    prompt: 'How was your experience?',
    commentLabel: 'Tell us more (optional)',
    commentPlaceholder: 'What you enjoyed, what we can improve…',
    submit: 'Send feedback',
    submitting: 'Sending…',
    ratingLabel: (n: number) => `${n} out of 5 stars`,
    thanksPositiveTitle: 'Thank you!',
    thanksPositiveBody:
      'Glad to hear your experience was positive. If you have a minute, share it publicly — it really helps.',
    thanksPositiveCta: 'Leave a public review',
    thanksNegativeTitle: 'Thanks for telling us.',
    thanksNegativeBody:
      'Sorry we fell short. A manager will reach out within 24 hours to make it right.',
    errorGeneric: "We couldn't process your submission. Try again.",
    errorRate: 'Too many attempts. Wait a moment and try again.',
    errorNotFound: 'This link is no longer valid. Reach out directly if you have a question.',
  },
};

export function FeedbackForm({
  token,
  locale,
  brandName,
  locationName,
  contactName,
  publicReviewUrl,
}: FeedbackFormProps): React.ReactElement {
  const copy = COPY[locale];
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{
    outcome: 'positive_routed' | 'negative_captured';
    redirectUrl: string | null;
  } | null>(null);

  const submit = (): void => {
    if (rating === null) return;
    setError(null);
    startTransition(async () => {
      const result = await submitFeedbackAction(null, {
        token,
        rating,
        comment: comment.trim().length > 0 ? comment.trim() : undefined,
      });
      if (result.ok) {
        setSubmitted(result.data);
      } else if (result.error.code === 'RATE_LIMITED') {
        setError(copy.errorRate);
      } else if (result.error.code === 'NOT_FOUND') {
        setError(copy.errorNotFound);
      } else {
        setError(copy.errorGeneric);
      }
    });
  };

  if (submitted) {
    return submitted.outcome === 'positive_routed' ? (
      <ThanksPositive
        copy={copy}
        redirectUrl={submitted.redirectUrl ?? publicReviewUrl}
      />
    ) : (
      <ThanksNegative copy={copy} />
    );
  }

  const display = hover ?? rating ?? 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold leading-tight">
          {contactName ? `${greeting(locale, contactName)}, ` : ''}
          {copy.prompt}
        </h1>
        <p className="text-sm text-muted-foreground">
          {brandName ? brandName : ''}
          {brandName && locationName ? ' · ' : ''}
          {locationName ? locationName : ''}
        </p>
      </div>

      <div
        className="flex items-center gap-2"
        role="radiogroup"
        aria-label={locale === 'es' ? 'Selecciona una calificación' : 'Pick a rating'}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={copy.ratingLabel(n)}
            className={cn(
              'transition-colors',
              'h-10 w-10 sm:h-12 sm:w-12',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              n <= display
                ? 'text-amber-500'
                : 'text-zinc-300 hover:text-amber-400 dark:text-zinc-700',
            )}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(null)}
            onClick={() => setRating(n)}
          >
            <Star className="h-full w-full fill-current" />
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="feedback-comment" className="text-xs uppercase tracking-wide text-muted-foreground">
          {copy.commentLabel}
        </label>
        <textarea
          id="feedback-comment"
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
        disabled={pending || rating === null}
        size="lg"
        className="self-stretch sm:self-start"
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

function ThanksPositive({
  copy,
  redirectUrl,
}: {
  copy: Copy;
  redirectUrl: string | null;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-start gap-4 py-8 text-left">
      <h1 className="text-3xl font-semibold leading-tight">{copy.thanksPositiveTitle}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {copy.thanksPositiveBody}
      </p>
      {redirectUrl ? (
        <Button asChild size="lg">
          <a href={redirectUrl} target="_blank" rel="noopener noreferrer">
            {copy.thanksPositiveCta}
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function ThanksNegative({ copy }: { copy: Copy }): React.ReactElement {
  return (
    <div className="flex flex-col items-start gap-4 py-8 text-left">
      <h1 className="text-3xl font-semibold leading-tight">{copy.thanksNegativeTitle}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {copy.thanksNegativeBody}
      </p>
    </div>
  );
}

function greeting(locale: 'es' | 'en', name: string): string {
  const first = name.split(/\s+/u)[0] ?? name;
  return locale === 'es' ? `Hola ${first}` : `Hi ${first}`;
}
