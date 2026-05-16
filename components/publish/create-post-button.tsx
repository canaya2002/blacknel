'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { createDraftAction } from '@/app/(app)/publish/actions';
import { Button } from '@/components/ui/button';

/**
 * Minimal Client wrapper for the "Nuevo post" CTA (Ajuste Y).
 *
 * Single responsibility:
 *
 *   1. On click, generate a fresh `crypto.randomUUID()` as the
 *      `idempotency_key` for the draft we're about to open.
 *   2. Invoke `createDraftAction(key)` — the Server Action
 *      delegates to `createOrFetchDraft` which inserts a fresh
 *      row OR resolves an existing one when the key matches.
 *   3. `router.push()` to `/publish/composer/<postId>`.
 *
 * `pending` blocks the second click during navigation so a
 * double-click is dropped. If the user *does* manage to fire
 * twice with two different keys (e.g. the first click crashed
 * before `startTransition`), the worst case is one orphaned
 * empty draft — no duplicate publish, no money at risk.
 *
 * Failure path: extremely rare in mock mode. We surface a tiny
 * inline error and let the user retry — explicit toast pipeline
 * lands in Commit 21.
 *
 * # Filename rationale
 *
 * Deliberately NOT named `new-post-cta.tsx` even though that's
 * the natural name — that filename was occupied historically by
 * a different shape from the `c52373e "seo"` commit (since
 * removed in C18 cleanup). Using `create-post-button.tsx` keeps
 * blame / git history readable for future devs.
 */
export function CreatePostButton(): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onClick = (): void => {
    if (pending) return;
    const idempotencyKey = crypto.randomUUID();
    startTransition(async () => {
      const result = await createDraftAction(null, { idempotencyKey });
      if (result.ok) {
        router.push(`/publish/composer/${result.data.postId}` as never);
        return;
      }
      // Fallback to the URL-driven entry — same key, same idempotent
      // resolution, exercised by the Server Component at /composer/new.
      router.push(`/publish/composer/new?key=${idempotencyKey}` as never);
    });
  };

  return (
    <Button onClick={onClick} disabled={pending}>
      <Plus className="h-4 w-4" aria-hidden />
      Nuevo post
    </Button>
  );
}
