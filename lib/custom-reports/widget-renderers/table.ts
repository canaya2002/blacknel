import 'server-only';

import { getDataSource, supportsRows, type DataSourceContext } from '../data-sources';
import { tableConfigSchema } from '../validate';
import type { TablePayload } from '../types';

/**
 * Phase 10 / Commit 39 — Table widget renderer.
 *
 * Pulls rows from the configured data source, projects the columns
 * declared in config, and caps at the configured limit (default 10,
 * max 50 enforced by Zod).
 */

export async function renderTable(
  config: unknown,
  ctx: DataSourceContext,
): Promise<TablePayload> {
  const parsed = tableConfigSchema.parse(config);
  const source = getDataSource(parsed.dataSource);
  if (!supportsRows(source) || !source.loadRows) {
    throw new Error(
      `Data source '${parsed.dataSource}' does not emit rows`,
    );
  }

  const rows = await source.loadRows(
    {
      limit: parsed.limit ?? 10,
      filters: parsed.filters ?? {},
    },
    ctx,
  );

  // Project to declared columns only — keep payload tight + avoid
  // leaking source-internal columns.
  const projected = rows.map((r) => {
    const out: Record<string, string | number | null> = {};
    for (const col of parsed.columns) {
      const v = r[col.key];
      out[col.key] = v === undefined ? null : v;
    }
    return out;
  });

  return {
    columns: parsed.columns,
    rows: projected,
  };
}
