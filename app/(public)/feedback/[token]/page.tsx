import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { loadFeedbackByToken } from '@/lib/reviews/public-feedback';

import { FeedbackForm } from './feedback-form';

export const dynamic = 'force-dynamic';

interface FeedbackPageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({
  params,
}: FeedbackPageProps): Promise<Metadata> {
  const { token } = await params;
  const ctx = await loadFeedbackByToken(token);
  if (!ctx) return { title: 'Feedback' };
  return {
    title: ctx.brandName
      ? `${ctx.brandName} — feedback`
      : 'Feedback',
    description:
      ctx.locale === 'en'
        ? `Share your experience with ${ctx.locationName ?? ctx.brandName ?? 'us'}.`
        : `Cuéntanos cómo fue tu experiencia con ${ctx.locationName ?? ctx.brandName ?? 'nosotros'}.`,
  };
}

/**
 * Public feedback landing. NO Blacknel chrome, NO auth gate. The
 * only thing tying this request to an org is the token in the URL,
 * and `loadFeedbackByToken` rejects any token that is malformed,
 * unknown, expired, or already-completed — all with the same `null`
 * return so a timing-oracle attacker can't tell which branch fired.
 *
 * Layout: brand identity in the header (the customer doesn't know
 * Blacknel exists yet), the 5-star picker + comment, and a friendly
 * footer credit at the bottom. Mobile-first — the most common entry
 * point is a phone tap from an SMS or email preview.
 *
 * Locale comes from the request's stored metadata (`contact_info.
 * locale`) which the orchestrator sets from the location's country
 * heuristic at send time. Phase 7 swaps to `brand_voice.locale`.
 */
export default async function FeedbackPage({
  params,
}: FeedbackPageProps): Promise<React.ReactElement> {
  const { token } = await params;
  const ctx = await loadFeedbackByToken(token);
  if (!ctx) {
    // Return 404 instead of a bespoke "invalid token" page so an
    // attacker can't distinguish "token shape is wrong" from "token
    // doesn't exist anymore" via the page body.
    notFound();
  }

  const locale: 'es' | 'en' = ctx.locale === 'en' ? 'en' : 'es';

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6 py-10 sm:py-16">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <span className="text-sm font-bold">
            {(ctx.brandName ?? '?').slice(0, 1).toUpperCase()}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight">
            {ctx.brandName ?? '—'}
          </span>
          {ctx.locationName ? (
            <span className="text-xs text-muted-foreground">{ctx.locationName}</span>
          ) : null}
        </div>
      </header>

      <FeedbackForm
        token={token}
        locale={locale}
        brandName={ctx.brandName}
        locationName={ctx.locationName}
        contactName={ctx.contactName}
        publicReviewUrl={ctx.publicReviewUrl}
      />
    </div>
  );
}
