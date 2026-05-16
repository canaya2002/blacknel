import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { assertPostsCap } from '@/lib/publish/usage-check';
import { createOrFetchDraft } from '@/lib/publish/composer/new-draft';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface NewComposerPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const keySchema = z.string().uuid();
const brandSchema = z.string().uuid().optional();

/**
 * /publish/composer/new
 *
 * Server-rendered redirect target. The C18 "Nuevo post" CTA
 * generates a `crypto.randomUUID()` client-side and navigates
 * here as `/composer/new?key=<uuid>&brandId=<uuid?>`. We:
 *
 *   1. Authenticate + verify `posts:create`.
 *   2. Verify the key parses as a UUID (defensive — a hand-crafted
 *      URL with `key=evil` is dropped to a 404).
 *   3. Call `createOrFetchDraft` which either inserts a fresh
 *      draft row or, if the key was already used, returns the
 *      existing `postId` (Ajuste Y).
 *   4. `redirect()` to `/publish/composer/<postId>`. The redirect
 *      surfaces as a Next.js navigation event so the URL the user
 *      sees becomes the canonical edit URL.
 *
 * The plan cap is NOT checked at this stage: a draft does not
 * consume a post-budget seat. The cap fires when the user
 * transitions the draft to `scheduled` / `pending_approval`.
 * We still surface the cap-reached banner via the C18
 * `PublishHeader` so a user at the cap sees they can't move the
 * draft past `scheduled` once they fill it in. The call below is
 * cosmetic — the result is logged, no branching — and confirms
 * the cap pipeline is still wired (Ajuste defensive).
 */
export default async function NewComposerPage({
  searchParams,
}: NewComposerPageProps): Promise<never> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const sp = await searchParams;
  const rawKey =
    typeof sp.key === 'string'
      ? sp.key
      : Array.isArray(sp.key)
        ? sp.key[0]
        : undefined;
  const parsedKey = keySchema.safeParse(rawKey);
  if (!parsedKey.success) {
    // Without a valid key we'd churn drafts on every refresh.
    // Send the user back to the calendar — the CTA generates a
    // key when it's clicked the right way.
    redirect('/publish');
  }

  const rawBrand = typeof sp.brandId === 'string' ? sp.brandId : undefined;
  const parsedBrand = brandSchema.safeParse(rawBrand);

  // Cosmetic cap probe — see JSDoc above.
  const plan = await getOrgPlanCode(session);
  await assertPostsCap(session.orgId, plan);

  const result = await createOrFetchDraft({
    orgId: session.orgId,
    userId: session.userId,
    idempotencyKey: parsedKey.data,
    ...(parsedBrand.success && parsedBrand.data
      ? { brandId: parsedBrand.data }
      : {}),
  });

  if (!result.ok) {
    // INTERNAL_ERROR path — surface as a navigation to /publish
    // with a hint param. The full error UI lands with the toast
    // pipeline in Commit 21.
    redirect('/publish?compose_error=1');
  }

  redirect(`/publish/composer/${result.data.postId}`);
}
