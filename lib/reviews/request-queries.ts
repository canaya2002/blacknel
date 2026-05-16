import 'server-only';

import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';

import { dbAs } from '../db/client';
import { brands, locations, reviewRequests } from '../db/schema';

/**
 * Reads for the `/reviews/requests` campaign list. Mirrors the
 * `loadReputationDashboardData` shape from Commit 15: ONE function
 * per page render that runs the per-card queries in parallel under
 * one `dbAs` transaction. The page is presentational on top of the
 * returned payload.
 */

export type RequestOutcome =
  | 'positive_routed'
  | 'negative_captured'
  | 'no_response'
  | 'expired';

export interface RequestListItem {
  readonly id: string;
  readonly channel: 'email' | 'sms' | 'whatsapp' | 'qr';
  readonly contactEmail: string | null;
  readonly contactName: string | null;
  readonly brandName: string | null;
  readonly locationName: string | null;
  readonly sentAt: Date | null;
  readonly openedAt: Date | null;
  readonly completedAt: Date | null;
  readonly outcome: RequestOutcome | null;
  readonly expiresAt: Date;
}

export interface RequestKpis {
  readonly sent: number;
  readonly opened: number;
  readonly completed: number;
  readonly positiveRouted: number;
  readonly negativeCaptured: number;
  /** 0..100 — `completed / sent`. Null when there are no sent. */
  readonly completionRate: number | null;
}

export interface RequestsDashboardData {
  readonly kpis: RequestKpis;
  readonly items: ReadonlyArray<RequestListItem>;
}

export interface LoadRequestsOpts {
  readonly orgId: string;
  readonly userId: string;
  /** Optional outcome filter — drives the secondary tab on the page. */
  readonly outcome?: RequestOutcome | 'pending';
  /** Optional date floor; defaults to 90 days back. */
  readonly since?: Date;
  /** Max items to return. Defaults to 50. */
  readonly limit?: number;
}

const DAY = 24 * 60 * 60 * 1000;

export async function loadReviewRequestsDashboard(
  opts: LoadRequestsOpts,
): Promise<RequestsDashboardData> {
  const since = opts.since ?? new Date(Date.now() - 90 * DAY);
  const limit = opts.limit ?? 50;

  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx): Promise<RequestsDashboardData> => {
      const baseConditions: SQL[] = [
        eq(reviewRequests.organizationId, opts.orgId),
      ];
      if (opts.outcome === 'pending') {
        baseConditions.push(sql`${reviewRequests.completedAt} IS NULL`);
      } else if (opts.outcome) {
        baseConditions.push(eq(reviewRequests.outcome, opts.outcome));
      }

      type AggRow = {
        sent: string | number;
        opened: string | number;
        completed: string | number;
        positive: string | number;
        negative: string | number;
      };
      const aggRows: AggRow[] = await tx
        .select({
          sent: count(reviewRequests.id),
          opened: sql<string | number>`COUNT(*) FILTER (WHERE ${reviewRequests.openedAt} IS NOT NULL)`.as('opened'),
          completed: sql<string | number>`COUNT(*) FILTER (WHERE ${reviewRequests.completedAt} IS NOT NULL)`.as('completed'),
          positive: sql<string | number>`COUNT(*) FILTER (WHERE ${reviewRequests.outcome} = 'positive_routed')`.as('positive'),
          negative: sql<string | number>`COUNT(*) FILTER (WHERE ${reviewRequests.outcome} = 'negative_captured')`.as('negative'),
        })
        .from(reviewRequests)
        .where(
          and(
            eq(reviewRequests.organizationId, opts.orgId),
            sql`${reviewRequests.sentAt} >= ${since}`,
          ),
        );
      const agg = aggRows[0] ?? {
        sent: 0,
        opened: 0,
        completed: 0,
        positive: 0,
        negative: 0,
      };
      const sentN = toNum(agg.sent) ?? 0;
      const completedN = toNum(agg.completed) ?? 0;
      const kpis: RequestKpis = {
        sent: sentN,
        opened: toNum(agg.opened) ?? 0,
        completed: completedN,
        positiveRouted: toNum(agg.positive) ?? 0,
        negativeCaptured: toNum(agg.negative) ?? 0,
        completionRate: sentN === 0 ? null : (completedN / sentN) * 100,
      };

      type Row = {
        id: string;
        channel: RequestListItem['channel'];
        contactInfo: unknown;
        brandName: string | null;
        locationName: string | null;
        sentAt: Date | null;
        openedAt: Date | null;
        completedAt: Date | null;
        outcome: RequestOutcome | null;
        expiresAt: Date;
      };

      const rows: Row[] = await tx
        .select({
          id: reviewRequests.id,
          channel: reviewRequests.channel,
          contactInfo: reviewRequests.contactInfo,
          brandName: brands.name,
          locationName: locations.name,
          sentAt: reviewRequests.sentAt,
          openedAt: reviewRequests.openedAt,
          completedAt: reviewRequests.completedAt,
          outcome: reviewRequests.outcome,
          expiresAt: reviewRequests.expiresAt,
        })
        .from(reviewRequests)
        .leftJoin(brands, eq(brands.id, reviewRequests.brandId))
        .leftJoin(locations, eq(locations.id, reviewRequests.locationId))
        .where(and(...baseConditions))
        .orderBy(desc(reviewRequests.sentAt), desc(reviewRequests.id))
        .limit(limit);

      const items: RequestListItem[] = rows.map((r) => {
        const ci =
          r.contactInfo && typeof r.contactInfo === 'object'
            ? (r.contactInfo as Record<string, unknown>)
            : {};
        return {
          id: r.id,
          channel: r.channel,
          contactEmail: typeof ci.email === 'string' ? (ci.email as string) : null,
          contactName: typeof ci.name === 'string' ? (ci.name as string) : null,
          brandName: r.brandName,
          locationName: r.locationName,
          sentAt: r.sentAt,
          openedAt: r.openedAt,
          completedAt: r.completedAt,
          outcome: r.outcome,
          expiresAt: r.expiresAt,
        };
      });

      return { kpis, items };
    },
  );
}

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
