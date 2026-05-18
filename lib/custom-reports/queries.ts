import 'server-only';

import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  customReportWidgets,
  customReports,
  users,
  type CustomReport,
  type CustomReportWidget,
} from '@/lib/db/schema';

/**
 * Phase 10 / Commit 39 — custom_reports + custom_report_widgets
 * read primitives.
 *
 * # Share scope semantics (D-39-4)
 *
 *   private        → only `created_by` user sees it.
 *   org_visible    → any org member with `custom_reports:read` —
 *                     RLS already gates org membership; the
 *                     permission check lives upstream in Server
 *                     Actions / Server Components that consume
 *                     these queries. This module only filters by
 *                     `shareScope`, not by permission.
 *   specific_users → user id in `shared_with[]` OR is creator.
 *
 * `listCustomReportsForUserWithTx` applies the share-scope filter
 * inline. Higher-level callers (Server Actions, page loaders)
 * still gate on `custom_reports:read` permission before invoking.
 */

export interface CustomReportListItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: CustomReport['status'];
  readonly shareScope: CustomReport['shareScope'];
  readonly createdBy: string | null;
  readonly createdByName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly widgetCount: number;
}

export interface CustomReportWithWidgets {
  readonly report: CustomReport;
  readonly widgets: ReadonlyArray<CustomReportWidget>;
}

export async function listCustomReportsForUserWithTx(
  tx: AnyPgTx,
  opts: {
    readonly orgId: string;
    readonly userId: string;
    readonly statuses?: ReadonlyArray<CustomReport['status']>;
  },
): Promise<ReadonlyArray<CustomReportListItem>> {
  const statuses = opts.statuses ?? ['draft', 'published'];

  // Visibility filter:
  //   created_by = user                                     OR
  //   share_scope = 'org_visible'                           OR
  //   share_scope = 'specific_users' AND user ∈ shared_with
  const visibility = or(
    eq(customReports.createdBy, opts.userId),
    eq(customReports.shareScope, 'org_visible'),
    and(
      eq(customReports.shareScope, 'specific_users'),
      sql`${opts.userId}::uuid = ANY(${customReports.sharedWith})`,
    ),
  );

  type Row = {
    id: string;
    name: string;
    description: string | null;
    status: CustomReport['status'];
    shareScope: CustomReport['shareScope'];
    createdBy: string | null;
    createdByName: string | null;
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
  };

  const rows: Row[] = await tx
    .select({
      id: customReports.id,
      name: customReports.name,
      description: customReports.description,
      status: customReports.status,
      shareScope: customReports.shareScope,
      createdBy: customReports.createdBy,
      createdByName: users.name,
      createdAt: customReports.createdAt,
      updatedAt: customReports.updatedAt,
      publishedAt: customReports.publishedAt,
    })
    .from(customReports)
    .leftJoin(users, eq(users.id, customReports.createdBy))
    .where(
      and(
        eq(customReports.organizationId, opts.orgId),
        inArray(customReports.status, statuses as CustomReport['status'][]),
        visibility,
      ),
    )
    .orderBy(desc(customReports.updatedAt));

  if (rows.length === 0) return [];

  type CountRow = { reportId: string; n: number };
  const widgetCounts: CountRow[] = await tx
    .select({
      reportId: customReportWidgets.customReportId,
      n: count(),
    })
    .from(customReportWidgets)
    .where(
      inArray(
        customReportWidgets.customReportId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(customReportWidgets.customReportId);

  const widgetMap = new Map<string, number>();
  for (const wc of widgetCounts) {
    widgetMap.set(wc.reportId, Number(wc.n));
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    status: r.status,
    shareScope: r.shareScope,
    createdBy: r.createdBy,
    createdByName: r.createdByName,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    publishedAt: r.publishedAt,
    widgetCount: widgetMap.get(r.id) ?? 0,
  }));
}

export async function getCustomReportWithWidgetsWithTx(
  tx: AnyPgTx,
  opts: { readonly orgId: string; readonly reportId: string },
): Promise<CustomReportWithWidgets | null> {
  const reportRows = await tx
    .select()
    .from(customReports)
    .where(
      and(
        eq(customReports.id, opts.reportId),
        eq(customReports.organizationId, opts.orgId),
      ),
    )
    .limit(1);

  const report = reportRows[0];
  if (!report) return null;

  const widgets = await tx
    .select()
    .from(customReportWidgets)
    .where(eq(customReportWidgets.customReportId, report.id))
    .orderBy(
      asc(customReportWidgets.positionRow),
      asc(customReportWidgets.positionCol),
      asc(customReportWidgets.displayOrder),
    );

  return { report, widgets };
}

export async function countCustomReportsByOrgWithTx(
  tx: AnyPgTx,
  opts: { readonly orgId: string },
): Promise<number> {
  const rows = await tx
    .select({ n: count() })
    .from(customReports)
    .where(
      and(
        eq(customReports.organizationId, opts.orgId),
        inArray(
          customReports.status,
          ['draft', 'published'] as CustomReport['status'][],
        ),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function listCustomReportsForUser(opts: {
  readonly orgId: string;
  readonly userId: string;
  readonly statuses?: ReadonlyArray<CustomReport['status']>;
}): Promise<ReadonlyArray<CustomReportListItem>> {
  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) => listCustomReportsForUserWithTx(tx, opts),
  );
}

export async function getCustomReportWithWidgets(opts: {
  readonly orgId: string;
  readonly userId: string;
  readonly reportId: string;
}): Promise<CustomReportWithWidgets | null> {
  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) => getCustomReportWithWidgetsWithTx(tx, opts),
  );
}
