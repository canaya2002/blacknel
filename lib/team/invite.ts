import 'server-only';

import { and, eq, gt, sql } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAs } from '@/lib/db/client';
import { invitations, organizations } from '@/lib/db/schema';
import { sendTemplatedEmail } from '@/lib/emails/client';
import type { EmailLocale } from '@/lib/emails/templates';
import { env } from '@/lib/env';
import {
  generateInvitationToken,
  invitationAcceptUrl,
  INVITATION_TTL_MS,
} from '@/lib/invitations/tokens';
import type { Role } from '@/lib/permissions/roles';
import type { PlanCode } from '@/lib/plans/plans';
import { err, ok, type Result } from '@/lib/types/result';
import { checkUsage, incrementUsage } from '@/lib/usage/counters';

/**
 * Team-invite orchestrator (C45 — real consumer of C44 Email + Inngest).
 *
 * Seats gate → insert invitation rows → send the typed bilingual `team_invite`
 * template via `sendTemplatedEmail` (Resend behind a flag; durable retry via
 * the Inngest `email.send` event when enabled, inline mock otherwise). Pending
 * invitations count against the plan's `users` cap (each accepted invite
 * consumes a seat).
 *
 * Extracted from `inviteTeamAction` so the seats + email path is testable
 * against pglite without the `requireUser` / `revalidatePath` boundaries the
 * Server Action carries (same pattern as `assertPostsCap`). The action stays a
 * thin auth + parse + revalidate wrapper.
 *
 * Emails are sent AFTER the invitation rows commit — a rolled-back insert never
 * produces an email, and `sendTemplatedEmail` opens its own admin connection
 * for `email_log` rather than nesting inside the invite transaction.
 */

export interface InviteRequest {
  readonly email: string;
  readonly role: Role;
}

export interface CreateInvitationsInput {
  readonly orgId: string;
  readonly userId: string;
  /** Display name of the inviter, shown in the email. */
  readonly inviterName: string;
  readonly invites: ReadonlyArray<InviteRequest>;
  readonly planCode: PlanCode;
}

export interface InviteDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  /** Override "now" for deterministic expiry/pending counts in tests. */
  now?: Date;
}

function defaultDeps(): InviteDeps {
  return {
    asUser: (ctx, fn) => dbAs(ctx, fn),
    asAdmin: (fn) => dbAdmin(fn),
  };
}

export async function createInvitations(
  input: CreateInvitationsInput,
  deps: InviteDeps = defaultDeps(),
): Promise<Result<{ count: number; pendingTotal: number }>> {
  const { orgId, userId, invites, planCode } = input;
  if (invites.length === 0) {
    return err('VALIDATION_ERROR', 'No hay invitaciones para enviar.');
  }

  // Seats gate: pending invites + active members must fit under the users cap.
  const usage = await deps.asAdmin((tx) =>
    checkUsage(tx, orgId, planCode, 'users', invites.length),
  );
  if (!usage.ok) {
    return err(
      'PLAN_LIMIT_REACHED',
      `Tu plan permite ${usage.cap} usuario(s) y ya tienes ${usage.current}. Sube de plan o cancela una invitación pendiente.`,
      { meta: { plan: planCode, cap: usage.cap, current: usage.current, delta: invites.length } },
    );
  }

  // Org name + locale for the email (invitee joins this org → use its locale).
  const orgRows = await deps.asUser<Array<{ name: string; locale: string }>>(
    { orgId, userId },
    (tx) =>
      tx
        .select({ name: organizations.name, locale: organizations.locale })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1),
  );
  const orgName = orgRows[0]?.name ?? 'Blacknel';
  const locale: EmailLocale = orgRows[0]?.locale === 'es' ? 'es' : 'en';

  const now = deps.now ?? new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  // Insert all rows in one tx, collecting the tokens to email after commit.
  const created: Array<{ email: string; role: Role; token: string }> = [];
  await deps.asUser({ orgId, userId }, async (tx) => {
    for (const invite of invites) {
      const token = generateInvitationToken();
      await tx.insert(invitations).values({
        organizationId: orgId,
        email: invite.email,
        role: invite.role,
        token,
        expiresAt,
        invitedBy: userId,
      });
      created.push({ email: invite.email, role: invite.role, token });
    }
  });

  // Pending invitations count against the users cap.
  await deps.asAdmin((tx) => incrementUsage(tx, orgId, 'users', created.length));

  // Send the typed invite email per row (Resend/Inngest behind flags; mock off).
  for (const c of created) {
    const acceptUrl = invitationAcceptUrl(env.NEXT_PUBLIC_APP_URL, c.token);
    await sendTemplatedEmail({
      template: 'team_invite',
      to: c.email,
      locale,
      orgId,
      data: { orgName, inviterName: input.inviterName, acceptUrl },
    });
  }

  const pending = await deps.asUser<Array<{ n: number }>>({ orgId, userId }, (tx) =>
    tx
      .select({ n: sql<number>`cast(count(*) as int)` })
      .from(invitations)
      .where(and(eq(invitations.organizationId, orgId), gt(invitations.expiresAt, now))),
  );

  return ok({ count: created.length, pendingTotal: pending[0]?.n ?? 0 });
}
