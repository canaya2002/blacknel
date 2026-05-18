import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth/server';
import { isMasterOrgOwner } from '@/lib/auth/master-org';

/**
 * Phase 11 / Commit 40 — `/admin/*` layout.
 *
 * Only the master org owner reaches this route group. Anyone
 * else (any role in any other org, or non-owner inside master
 * org) gets 404 — we don't even disclose that the path exists.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const session = await requireUser();
  if (!isMasterOrgOwner(session)) {
    notFound();
  }
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card/40 px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Master org · ops
          </span>
        </div>
      </header>
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
