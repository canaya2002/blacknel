/**
 * Commit 18 — Ajuste C helper.
 *
 * Pin a `usage_counters` row to an arbitrary value so the demo
 * /publish page renders the amber cap-reached banner without
 * generating real posts. Reproducible setup for closing demos.
 *
 * Usage (PowerShell):
 *
 *   pnpm tsx scripts/dev-checks/fake-usage-cap.ts <orgSlug> <metric> <value>
 *
 * Examples:
 *
 *   # Pin Blacknel Demo to its Standard cap (30):
 *   pnpm tsx scripts/dev-checks/fake-usage-cap.ts blacknel-demo postsPerMonth 30
 *
 *   # Reset back to 0:
 *   pnpm tsx scripts/dev-checks/fake-usage-cap.ts blacknel-demo postsPerMonth 0
 *
 *   # Quick alias: argv[1] defaults to "blacknel-demo".
 *   pnpm tsx scripts/dev-checks/fake-usage-cap.ts postsPerMonth 30
 *
 * Run with the dev server stopped to avoid pglite lock contention.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

const DATA_DIR = path.resolve(process.cwd(), '.blacknel/pglite-data');

const SUPPORTED_METRICS = new Set([
  'brands',
  'users',
  'socialAccounts',
  'locations',
  'postsPerMonth',
  'reviewRequestsPerMonth',
]);

const WINDOWED_METRICS = new Set(['postsPerMonth', 'reviewRequestsPerMonth']);

function parseArgs(): { orgSlug: string; metric: string; value: number } {
  const raw = process.argv.slice(2);
  // Form: <orgSlug> <metric> <value>
  // Shorthand: <metric> <value> (defaults orgSlug to blacknel-demo)
  let orgSlug = 'blacknel-demo';
  let metric: string | undefined;
  let valueRaw: string | undefined;
  if (raw.length === 3) {
    orgSlug = raw[0] ?? orgSlug;
    metric = raw[1];
    valueRaw = raw[2];
  } else if (raw.length === 2) {
    metric = raw[0];
    valueRaw = raw[1];
  } else {
    throw new Error(
      'Uso: fake-usage-cap.ts <orgSlug> <metric> <value>  o bien  <metric> <value> (orgSlug=blacknel-demo)',
    );
  }
  if (!metric || !SUPPORTED_METRICS.has(metric)) {
    throw new Error(
      `Métrica desconocida: ${metric}. Métricas válidas: ${Array.from(SUPPORTED_METRICS).join(', ')}`,
    );
  }
  const value = Number(valueRaw);
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`Value inválido: ${valueRaw} (debe ser entero >= 0)`);
  }
  return { orgSlug, metric, value };
}

function currentMonthPeriod(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

async function main(): Promise<void> {
  const { orgSlug, metric, value } = parseArgs();
  const pg = new PGlite(DATA_DIR);
  await pg.waitReady;

  const orgRows = await pg.query<{ id: string }>(
    `SELECT id FROM organizations WHERE slug = $1 LIMIT 1`,
    [orgSlug],
  );
  const org = orgRows.rows[0];
  if (!org) {
    console.error(`Org con slug '${orgSlug}' no encontrada en el dev DB.`);
    await pg.close();
    process.exit(1);
  }

  const period = WINDOWED_METRICS.has(metric)
    ? currentMonthPeriod()
    : { start: '-infinity', end: 'infinity' };

  await pg.query(
    `INSERT INTO usage_counters
       (organization_id, metric, period_start, period_end, value)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, metric, period_start) DO UPDATE
       SET value = EXCLUDED.value`,
    [org.id, metric, period.start, period.end, value],
  );

  const after = await pg.query<{ value: number }>(
    `SELECT value FROM usage_counters
      WHERE organization_id = $1 AND metric = $2 AND period_start = $3`,
    [org.id, metric, period.start],
  );

  console.log(`OK · org=${orgSlug} · metric=${metric} · value=${after.rows[0]?.value}`);
  console.log(
    'Recarga /publish: si el cap del plan es alcanzado, verás el banner amber en lugar del CTA.',
  );
  await pg.close();
}

main().catch(async (err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
