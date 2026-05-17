import 'server-only';

import type { EmailKind } from './send';

/**
 * In-memory outbox for dev / test runs. The `sendEmail` impl pushes
 * every message here; tests inspect it via `getDevOutbox()` /
 * `clearDevOutbox()`. Resets per process — survives across requests
 * during the same `pnpm dev` session but not across restarts.
 *
 * Not a queue. Order is preserved by push-time.
 */

export interface DevOutboxMessage {
  id: string;
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  /** Optional HTML body (Phase 9 / Commit 34, R-34-2). */
  html?: string;
  meta?: Record<string, unknown>;
  sentAt: Date;
}

const _outbox: DevOutboxMessage[] = [];

export function pushToDevOutbox(msg: DevOutboxMessage): void {
  _outbox.push(msg);
  // Cap the outbox so long dev sessions don't leak unbounded memory.
  if (_outbox.length > 500) _outbox.shift();
}

export function getDevOutbox(): ReadonlyArray<DevOutboxMessage> {
  return _outbox;
}

export function clearDevOutbox(): void {
  _outbox.length = 0;
}
