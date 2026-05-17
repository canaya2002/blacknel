import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { loadNpsByToken } from '@/lib/nps/public-response';

import { NpsResponseForm } from './response-form';

export const dynamic = 'force-dynamic';

interface NpsPageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({
  params,
}: NpsPageProps): Promise<Metadata> {
  const { token } = await params;
  const ctx = await loadNpsByToken(token);
  if (!ctx) return { title: 'NPS' };
  return {
    title: ctx.surveyName,
    description:
      ctx.locale === 'en'
        ? 'Share quick feedback — takes about 30 seconds.'
        : 'Cuéntanos rápidamente cómo estuvo — toma 30 segundos.',
  };
}

/**
 * Public NPS landing (Phase 9 / Commit 32).
 *
 * Same security posture as `/feedback/[token]` — no Blacknel chrome,
 * no auth. `loadNpsByToken` rejects malformed / unknown / expired /
 * already-responded tokens with an identical `null` return so the
 * 404 page renders for each branch uniformly.
 *
 * Mobile-first: 11 buttons (0-10) wrap on small screens, comment
 * textarea below, single CTA at the bottom. No tracker, no
 * marketing chrome — this surface is the customer's first
 * interaction with the brand outside the conversation that
 * triggered the survey.
 */
export default async function NpsPage({
  params,
}: NpsPageProps): Promise<React.ReactElement> {
  const { token } = await params;
  const ctx = await loadNpsByToken(token);
  if (!ctx) {
    notFound();
  }

  const locale: 'es' | 'en' = ctx.locale === 'en' ? 'en' : 'es';

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6 py-10 sm:py-16">
      <header className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {locale === 'en' ? 'Quick feedback' : 'Feedback rápido'}
        </span>
        <h1 className="text-xl font-semibold leading-tight">
          {ctx.surveyName}
        </h1>
      </header>

      <NpsResponseForm
        token={token}
        locale={locale}
        questionText={ctx.questionText}
        contactName={ctx.contactName}
        thankYouMessage={ctx.thankYouMessage}
      />
    </div>
  );
}
