import 'server-only';

import { and, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin } from '@/lib/db/client';
import {
  contactProfiles,
  inboxThreads,
  npsSurveys,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import { ok, type Result } from '@/lib/types/result';

import {
  type DispatchInvitationInput,
  type DispatchOutcome,
  dispatchInvitationAsAdmin,
} from './sender';

/**
 * DB + dispatch dependency seam. Production uses `dbAdmin` + the
 * real sender; tests inject an `asAdmin` bound to a test pglite and
 * a `dispatch` spy that records calls + returns synthetic outcomes
 * (so the cron test stays focused on discovery + grouping +
 * counting, while the actual dispatch is verified in
 * `nps-invitation-send.test.ts`).
 */
export interface PostResolutionDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  dispatch: (
    input: DispatchInvitationInput,
  ) => Promise<Result<DispatchOutcome>>;
}

const defaultDeps: PostResolutionDeps = {
  asAdmin: (fn) => dbAdmin(fn),
  dispatch: (input) => dispatchInvitationAsAdmin(input),
};

/**
 * NPS triggers (Phase 9 / Commit 32).
 *
 * Three of the four `nps_survey_trigger` values are implemented as
 * cron-or-Server-Action surfaces in Commit 32:
 *
 *   - `post_resolution` — the only cron-driven trigger this commit.
 *     `runPostResolutionTick()` scans `inbox_threads.status='closed'`
 *     in the last 24h and dispatches invitations against the contact
 *     attached to each thread, for every active `nps_surveys` row
 *     with `trigger='post_resolution'` belonging to the same org.
 *
 *   - `manual` — handled directly by `sendNpsInvitationAction` in
 *     `app/(app)/nps/actions.ts`. No tick.
 *
 *   - `post_purchase` — stub. Wired when commerce-event hooks land
 *     in Phase 10+.
 *
 *   - `periodic` — stub. Monthly cron lands in Phase 10+.
 */

export interface PostResolutionTickResult {
  readonly threadsConsidered: number;
  readonly invitationsSent: number;
  readonly throttled: number;
  readonly skipped: number;
}

const WINDOW_MS = 24 * 60 * 60_000;

/**
 * Single cron tick. The caller (`lib/jobs/nps-scan.ts`) wraps this
 * with the `tickInFlight` guard + log shape used by the other crons.
 *
 * Idempotency strategy: the `nps_invitations_one_per_day` unique
 * index guarantees a contact can't receive two invitations for the
 * same survey on the same UTC day. The sender's `min_days_between_
 * sends` throttle further reduces churn. Re-running the tick within
 * the window is therefore safe — no duplicates inserted, the
 * throttled branch is reported in the counts.
 */
export async function runPostResolutionTick(input?: {
  now?: Date;
  deps?: PostResolutionDeps;
}): Promise<Result<PostResolutionTickResult>> {
  const now = input?.now ?? new Date();
  const deps = input?.deps ?? defaultDeps;
  const cutoff = new Date(now.getTime() - WINDOW_MS);

  // 1) Discover (org, contact, closed_at) tuples from threads
  //    closed in the last 24h. asAdmin — this is a cross-tenant
  //    scan executed by the system actor.
  const candidates = await deps.asAdmin(async (tx) =>
    tx
      .select({
        organizationId: inboxThreads.organizationId,
        threadId: inboxThreads.id,
        closedAt: inboxThreads.closedAt,
        contactPlatform: contactProfiles.platform,
        contactExternalId: contactProfiles.externalId,
        contactDisplayName: contactProfiles.displayName,
      })
      .from(inboxThreads)
      .innerJoin(
        contactProfiles,
        eq(contactProfiles.id, inboxThreads.contactProfileId),
      )
      .where(
        and(
          eq(inboxThreads.status, 'closed'),
          isNotNull(inboxThreads.closedAt),
          gte(inboxThreads.closedAt, cutoff),
        ),
      )
      .orderBy(desc(inboxThreads.closedAt)),
  );

  // 2) Discover active post_resolution surveys, grouped by org.
  const activeSurveys = await deps.asAdmin(async (tx) =>
    tx
      .select({
        id: npsSurveys.id,
        organizationId: npsSurveys.organizationId,
        brandId: npsSurveys.brandId,
        channels: npsSurveys.channels,
      })
      .from(npsSurveys)
      .where(
        and(
          eq(npsSurveys.trigger, 'post_resolution'),
          eq(npsSurveys.status, 'active'),
          isNull(npsSurveys.archivedAt),
        ),
      ),
  );

  const surveysByOrg = new Map<
    string,
    Array<(typeof activeSurveys)[number]>
  >();
  for (const s of activeSurveys) {
    const existing = surveysByOrg.get(s.organizationId);
    if (existing) existing.push(s);
    else surveysByOrg.set(s.organizationId, [s]);
  }

  // 3) Dispatch — one invitation per (survey × candidate).
  let invitationsSent = 0;
  let throttled = 0;
  let skipped = 0;

  for (const c of candidates) {
    const orgSurveys = surveysByOrg.get(c.organizationId);
    if (!orgSurveys || orgSurveys.length === 0) {
      skipped += 1;
      continue;
    }
    for (const s of orgSurveys) {
      // Pick the first channel of the survey; multi-channel fan-out
      // would land in a Phase 10+ refinement.
      const channel = s.channels[0];
      if (!channel) {
        skipped += 1;
        continue;
      }
      const channelTyped = channel as 'email' | 'whatsapp' | 'sms_reserved';
      if (channelTyped === 'sms_reserved') {
        skipped += 1;
        continue;
      }
      const result = await deps.dispatch({
        organizationId: c.organizationId,
        userId: null,
        surveyId: s.id,
        contactIdentifier: c.contactExternalId,
        contactName: c.contactDisplayName,
        channel: channelTyped,
        brandId: s.brandId,
        idempotencyKey: `post-resolution:${c.threadId}:${s.id}`,
        now,
      });
      if (!result.ok) {
        log.warn(
          {
            err: result.error.message,
            threadId: c.threadId,
            surveyId: s.id,
          },
          'nps.post_resolution.dispatch.failed',
        );
        skipped += 1;
        continue;
      }
      if (result.data.kind === 'throttled') {
        throttled += 1;
        continue;
      }
      invitationsSent += 1;
    }
  }

  log.info(
    {
      threadsConsidered: candidates.length,
      invitationsSent,
      throttled,
      skipped,
    },
    'nps.post_resolution.tick',
  );

  return ok({
    threadsConsidered: candidates.length,
    invitationsSent,
    throttled,
    skipped,
  });
}
