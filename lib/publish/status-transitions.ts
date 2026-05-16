/**
 * Pure-function lifecycle gates for the `posts.status` enum.
 *
 * The publish-job (Commit 20) and Server Actions (Commit 17+)
 * both call `canTransition` BEFORE writing a status update so we
 * never end up with an illegal transition in the DB. The status
 * graph is small enough that a table-driven check is simpler and
 * more auditable than a switch tree.
 *
 *     draft               → scheduled
 *     draft               → pending_approval
 *     draft               → published         (publish-now path)
 *     draft               → cancelled
 *     pending_approval    → scheduled
 *     pending_approval    → publishing        (approve + publish-now)
 *     pending_approval    → cancelled
 *     scheduled           → publishing
 *     scheduled           → cancelled
 *     scheduled           → draft             (un-schedule)
 *     publishing          → published
 *     publishing          → failed
 *     failed              → scheduled         (manual retry)
 *     failed              → draft             (back to editor)
 *     published           → (terminal)
 *     cancelled           → (terminal)
 */

import type { PostListStatus } from './queries';

export type PostStatus = PostListStatus;

const ALLOWED_TRANSITIONS: Readonly<Record<PostStatus, ReadonlyArray<PostStatus>>> = {
  draft: ['scheduled', 'pending_approval', 'published', 'cancelled'],
  pending_approval: ['scheduled', 'publishing', 'cancelled'],
  scheduled: ['publishing', 'cancelled', 'draft'],
  publishing: ['published', 'failed'],
  failed: ['scheduled', 'draft'],
  published: [],
  cancelled: [],
};

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedTransitionsFrom(from: PostStatus): ReadonlyArray<PostStatus> {
  return ALLOWED_TRANSITIONS[from];
}

/**
 * Terminal statuses are `published` and `cancelled`. Server
 * Actions reject mutations to terminal rows up front instead of
 * letting `canTransition` return `false` and surfacing a generic
 * VALIDATION_ERROR.
 */
export function isTerminal(status: PostStatus): boolean {
  return status === 'published' || status === 'cancelled';
}
