'use server';

import { headers } from 'next/headers';
import { z } from 'zod';

import { defaultFeedbackRateLimiter } from '@/lib/reviews/rate-limit';
import {
  submitFeedback,
  type FeedbackOutcome,
} from '@/lib/reviews/public-feedback';
import { err, type Result } from '@/lib/types/result';

/**
 * Public Server Action behind the feedback form. NO auth — the only
 * thing tying the request to an org is the token in the URL, which
 * `submitFeedback` validates with the same defenses as the
 * page-load resolver (`loadFeedbackByToken`).
 *
 * Per-IP rate limit (5/60s) fires BEFORE we touch the DB. The
 * limiter abstraction lives in `lib/reviews/rate-limit.ts` so the
 * Phase-11 Upstash cutover is one line in `defaultFeedbackRateLimiter`.
 *
 * The `RATE_LIMITED` branch returns the same `err` shape as everything
 * else — the client component (`feedback-form.tsx`) renders a generic
 * "demasiados intentos" message without revealing the bucket.
 */

const submitSchema = z.object({
  token: z.string().min(1).max(64),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(4000).optional(),
});

export async function submitFeedbackAction(
  _prev: unknown,
  input: { token: string; rating: number; comment?: string },
): Promise<Result<FeedbackOutcome>> {
  const ip = await clientIp();
  const limiter = defaultFeedbackRateLimiter();
  const verdict = await limiter.checkRate(ip, 'feedback.submit');
  if (!verdict.allowed) {
    return err('RATE_LIMITED', 'Demasiados intentos. Intenta de nuevo en un minuto.', {
      meta: { retryAfterSeconds: verdict.retryAfterSeconds },
    });
  }

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos inválidos.');
  }

  return submitFeedback({
    token: parsed.data.token,
    rating: parsed.data.rating,
    comment: parsed.data.comment ?? null,
  });
}

/**
 * Best-effort client IP for the rate limiter. Order: Vercel's
 * `x-forwarded-for` (first hop), Cloudflare's `cf-connecting-ip`,
 * standard `x-real-ip`. Falls back to a sentinel so an unknown
 * source can't bypass the limit by stripping headers.
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? '0.0.0.0';
}
