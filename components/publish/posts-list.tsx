'use client';

import { Virtuoso } from 'react-virtuoso';

import type { PostListItem } from '@/lib/publish/queries';

import { PostListRow } from './post-list-row';

interface PostsListProps {
  posts: ReadonlyArray<PostListItem>;
  timeZone: string;
  locale: string;
  /** True when the page has more posts than this batch. Footer hint. */
  hasMore: boolean;
}

/**
 * Virtualized list used by the named tabs (drafts / scheduled /
 * published / failed). react-virtuoso keeps rendering cheap even
 * with 500+ rows; the `style` height comes from the parent because
 * the page already reserves vertical space below the filter bar.
 *
 * Cursor pagination is deferred to Commit 21 (TODO #5
 * `polling-scroll-and-url-state`). For now we show the first batch
 * the loader returned and surface a hint when `hasMore` is true.
 */
export function PostsList({
  posts,
  timeZone,
  locale,
  hasMore,
}: PostsListProps): React.ReactElement {
  return (
    <div
      data-testid="publish-posts-list"
      className="flex flex-col"
      style={{ height: 'calc(100vh - 22rem)' }}
    >
      <Virtuoso
        data={posts as PostListItem[]}
        itemContent={(_index, post) => (
          <PostListRow post={post} timeZone={timeZone} locale={locale} />
        )}
        components={{
          Footer: hasMore
            ? () => (
                <div className="border-t bg-card/30 px-6 py-3 text-center text-xs text-muted-foreground">
                  Mostrando los primeros {posts.length} posts. La paginación
                  completa llega en Commit 21.
                </div>
              )
            : undefined,
        }}
      />
    </div>
  );
}
