'use client';

import { useRouter } from 'next/navigation';

import {
  POLL_INTERVAL_INBOX_LIST_MS,
  POLL_INTERVAL_THREAD_DETAIL_MS,
  usePolling,
} from '@/components/common/use-polling';

/**
 * Inbox-list polling host. Mount once in the /inbox page; renders no
 * DOM. Triggers `router.refresh()` on each tick, which re-runs the
 * server component with the user's existing URL state (filters + cursor
 * already in the URL → preserved).
 */
export function InboxListPolling(): null {
  const router = useRouter();
  usePolling(() => router.refresh(), { intervalMs: POLL_INTERVAL_INBOX_LIST_MS });
  return null;
}

export function ThreadDetailPolling(): null {
  const router = useRouter();
  usePolling(() => router.refresh(), { intervalMs: POLL_INTERVAL_THREAD_DETAIL_MS });
  return null;
}
