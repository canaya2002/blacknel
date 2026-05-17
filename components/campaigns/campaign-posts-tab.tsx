import 'server-only';

import { Inbox } from 'lucide-react';

import { PostListRow } from '@/components/publish/post-list-row';
import { listPostsForOrg } from '@/lib/publish/queries';

interface CampaignPostsTabProps {
  orgId: string;
  userId: string;
  postIds: ReadonlyArray<string>;
  timeZone: string;
  locale: string;
}

/**
 * Posts tab of /publish/campaigns/[id]. Reuses the
 * `<PostListRow />` from /publish so the row treatment, retry chip,
 * and last-error display all behave identically.
 *
 * The detail page hands us `postIds` already filtered + ordered;
 * we just hydrate them via the existing `listPostsForOrg` query
 * (RLS-scoped, same shape as /publish list).
 */
export async function CampaignPostsTab({
  orgId,
  userId,
  postIds,
  timeZone,
  locale,
}: CampaignPostsTabProps): Promise<React.ReactElement> {
  if (postIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/30 px-6 py-12 text-center">
        <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold tracking-tight">
          Aún sin posts en la campaña
        </h3>
        <p className="max-w-sm text-xs text-muted-foreground">
          Crea un post desde /publish y elige esta campaña en el composer
          para que aparezca aquí.
        </p>
      </div>
    );
  }

  // Re-fetch using listPostsForOrg so we inherit retry_count +
  // last_error subqueries, brand / campaign / author joins, etc.
  // Filtering by ids — simplest: load org's first 500 and keep
  // the intersection. The detail loader caps `postIds` at 200, so
  // this is bounded.
  const page = await listPostsForOrg({
    orgId,
    userId,
    filters: {},
    cursor: null,
    pageSize: 500,
  });
  const idSet = new Set(postIds);
  const filtered = page.posts.filter((p) => idSet.has(p.id));
  // Order by descending createdAt — same as the list view.
  return (
    <div className="flex flex-col rounded-lg border bg-card/30">
      {filtered.map((p) => (
        <PostListRow key={p.id} post={p} timeZone={timeZone} locale={locale} />
      ))}
    </div>
  );
}
