'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { suggestReviewReply } from '@/lib/ai/skills/review-response';
import { dbAs } from '@/lib/db/client';
import { brands, locations, reviews } from '@/lib/db/schema';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * AI-suggest button on the response composer. Stays inside its own
 * Server Action so:
 *
 *   - Auth + RBAC run before the (free in Phase 5, paid in Phase 7)
 *     suggestion compute fires.
 *   - The orchestrator can hop straight to a real Claude call in
 *     Phase 7 by replacing the body of `suggestReviewResponse`
 *     without touching the composer client code.
 *   - Future audit row goes here (`ai.suggestion.generated`) — left
 *     unwired in Phase 5 since the suggestion is deterministic and
 *     free; Phase 7 will add it.
 */

const inputSchema = z.object({ reviewId: z.string().uuid() });

export interface SuggestActionResult {
  body: string;
  variantIndex: number;
  bucket: 'positive' | 'neutral' | 'negative';
  unresolvedVariables: ReadonlyArray<string>;
}

export async function suggestResponseAction(
  _prev: unknown,
  input: { reviewId: string },
): Promise<Result<SuggestActionResult>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const rows = await dbAs<
    Array<{
      id: string;
      rating: number;
      body: string;
      authorName: string | null;
      brandName: string | null;
      locationName: string | null;
    }>
  >({ orgId: session.orgId, userId: session.userId }, async (tx) =>
    tx
      .select({
        id: reviews.id,
        rating: reviews.rating,
        body: reviews.body,
        authorName: reviews.authorName,
        brandName: brands.name,
        locationName: locations.name,
      })
      .from(reviews)
      .leftJoin(brands, eq(brands.id, reviews.brandId))
      .leftJoin(locations, eq(locations.id, reviews.locationId))
      .where(
        and(
          eq(reviews.id, parsed.data.reviewId),
          eq(reviews.organizationId, session.orgId),
        ),
      )
      .limit(1),
  );
  if (rows.length === 0) return err('NOT_FOUND', 'Review no encontrada.');
  const row = rows[0]!;

  // Commit 24 — async through aiClient. AiContext.entityId is
  // ROOT reviews.id (Ajuste 2), NEVER review_responses.id. A
  // single review may spawn multiple draft / suggested /
  // edited / approved response rows; all generations tied to it
  // should join on the review root.
  const suggestion = await suggestReviewReply({
    input: {
      reviewId: row.id,
      rating: row.rating,
      authorName: row.authorName,
      brandName: row.brandName,
      locationName: row.locationName,
    },
    reviewBody: row.body,
    context: {
      orgId: session.orgId,
      userId: session.userId,
      actorType: 'user',
      entityType: 'review',
      entityId: row.id,
    },
  });

  return ok({
    body: suggestion.body,
    variantIndex: suggestion.variantIndex,
    bucket: suggestion.bucket,
    unresolvedVariables: suggestion.unresolvedVariables,
  });
}
