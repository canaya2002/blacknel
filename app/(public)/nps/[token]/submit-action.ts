'use server';

import { headers } from 'next/headers';
import { z } from 'zod';

import {
  submitNpsResponse,
  type NpsSubmitOutcome,
} from '@/lib/nps/public-response';
import { defaultFeedbackRateLimiter } from '@/lib/reviews/rate-limit';
import { err, type Result } from '@/lib/types/result';

/**
 * Public NPS submit Server Action (Phase 9 / Commit 32).
 *
 * No auth — the only thing tying the request to an org is the token,
 * which `submitNpsResponse` validates with the same defenses as the
 * page-load resolver. Per-IP rate limit (5/60s) fires BEFORE we
 * touch the DB; the limiter is shared with the Phase-5 feedback flow
 * (same pool, distinct bucket name).
 */

const submitSchema = z.object({
  token: z.string().min(1).max(64),
  score: z.number().int().min(0).max(10),
  comment: z.string().max(4000).optional(),
});

export async function submitNpsResponseAction(
  _prev: unknown,
  input: { token: string; score: number; comment?: string },
): Promise<Result<NpsSubmitOutcome>> {
  const ip = await clientIp();
  const ua = await clientUserAgent();
  const limiter = defaultFeedbackRateLimiter();
  const verdict = await limiter.checkRate(ip, 'nps.submit');
  if (!verdict.allowed) {
    return err(
      'RATE_LIMITED',
      'Demasiados intentos. Intenta de nuevo en un minuto.',
      { meta: { retryAfterSeconds: verdict.retryAfterSeconds } },
    );
  }

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos inválidos.');
  }

  return submitNpsResponse({
    token: parsed.data.token,
    score: parsed.data.score,
    comment: parsed.data.comment ?? null,
    ipAddress: anonymizeIp(ip),
    userAgent: ua,
  });
}

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? '0.0.0.0';
}

async function clientUserAgent(): Promise<string | null> {
  const h = await headers();
  return h.get('user-agent');
}

/**
 * Light anonymization — strip the last octet of IPv4 / last 80 bits
 * of IPv6 before storing. Enough to keep regional analytics useful
 * (Phase 11) without holding the full address. Phase 11 compliance
 * review will tighten this further.
 */
function anonymizeIp(ip: string): string {
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}::`;
  }
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts.slice(0, 3).join('.')}.0`;
  }
  return ip;
}
