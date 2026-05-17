-- ---------------------------------------------------------------------------
-- 0017_competitors_and_scheduled_reports.sql — Phase 9 / Commit 34
--
-- Last two Growth-tier features before Phase 9 closes:
--
--   * Competitors tracking — `competitors` (per-brand watchlist) +
--     `competitor_metrics_daily` (rollup pattern of
--     `ads_spend_daily` from Phase 8). Mock-fed today, Phase 11
--     swaps to Brand24 / SimilarWeb.
--
--   * Scheduled report emails — `scheduled_reports` (per-org
--     configuration) + `scheduled_report_runs` (audit + status of
--     each dispatch). The 7th cron timer (15 min) selects rows
--     with `next_run_at <= now` and `status='active'`, builds an
--     HTML report, and posts it to the dev outbox.
--
-- No charter touches on Phase 1-7 schemas. `lib/emails/send.ts`
-- gets an optional `html` field (R-34-2, documented in
-- CHANGELOG).
-- ---------------------------------------------------------------------------

-- ---- ENUMS ----------------------------------------------------------------

CREATE TYPE competitor_status AS ENUM (
  'active',
  'paused',
  'archived'
);

CREATE TYPE scheduled_report_kind AS ENUM (
  'weekly',
  'monthly',
  'custom'
);

CREATE TYPE scheduled_report_status AS ENUM (
  'active',
  'paused',
  'archived'
);

CREATE TYPE scheduled_report_run_status AS ENUM (
  'queued',
  'running',
  'sent',
  'failed'
);

-- ---- competitors ----------------------------------------------------------

CREATE TABLE competitors (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id                 uuid REFERENCES brands(id) ON DELETE SET NULL,
  name                     text NOT NULL,
  -- Platforms watched + handle per platform (jsonb because the
  -- value-per-key shape doesn't fit a column array cleanly).
  -- Example: `{ "instagram": "@brand_x", "x": "@brandx" }`
  handles                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  platforms                text[] NOT NULL,
  status                   competitor_status NOT NULL DEFAULT 'active',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz,
  CONSTRAINT competitors_platforms_nonempty
    CHECK (cardinality(platforms) >= 1),
  CONSTRAINT competitors_unique_per_brand
    UNIQUE (organization_id, brand_id, name)
);

CREATE INDEX competitors_org_status_idx
  ON competitors (organization_id, status);
CREATE INDEX competitors_org_active_idx
  ON competitors (organization_id)
  WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON competitors TO authenticated;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY competitors_tenant ON competitors
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- competitor_metrics_daily ---------------------------------------------
--
-- Same rollup model as `ads_spend_daily` (Phase 8 / Commit 28):
-- one row per (competitor, platform, UTC day). `share_of_voice`
-- semantics documented at the schema TS file — vol-only ratio
-- of competitor posts vs (competitor + own-brand) posts on that
-- platform/day. NOT engagement-weighted (Ajuste C).

CREATE TABLE competitor_metrics_daily (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_id            uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  platform                 text NOT NULL,
  day                      date NOT NULL,
  posts_count              integer NOT NULL DEFAULT 0,
  engagement_total         integer NOT NULL DEFAULT 0,
  sentiment_score          numeric(3, 2) NOT NULL DEFAULT 0,
  share_of_voice           numeric(4, 3) NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitor_metrics_unique_day
    UNIQUE (competitor_id, platform, day),
  CONSTRAINT competitor_metrics_sov_range
    CHECK (share_of_voice >= 0 AND share_of_voice <= 1),
  CONSTRAINT competitor_metrics_sentiment_range
    CHECK (sentiment_score >= -1 AND sentiment_score <= 1)
);

CREATE INDEX competitor_metrics_org_day_idx
  ON competitor_metrics_daily (organization_id, day DESC);
CREATE INDEX competitor_metrics_competitor_day_idx
  ON competitor_metrics_daily (competitor_id, day DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON competitor_metrics_daily TO authenticated;
ALTER TABLE competitor_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY competitor_metrics_tenant ON competitor_metrics_daily
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- scheduled_reports ----------------------------------------------------

CREATE TABLE scheduled_reports (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id                 uuid REFERENCES brands(id) ON DELETE SET NULL,
  name                     text NOT NULL,
  kind                     scheduled_report_kind NOT NULL,
  -- Cron-style schedule, parsed by `lib/scheduled-reports/schedule.ts`.
  -- For `weekly` / `monthly` we accept simplified "day-of-week HH:MM"
  -- / "day-of-month HH:MM"; `custom` accepts a normal 5-field cron.
  schedule_expr            text NOT NULL,
  recipients               text[] NOT NULL,
  status                   scheduled_report_status NOT NULL DEFAULT 'active',
  next_run_at              timestamptz NOT NULL,
  last_run_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_reports_recipients_nonempty
    CHECK (cardinality(recipients) >= 1)
);

CREATE INDEX scheduled_reports_org_status_idx
  ON scheduled_reports (organization_id, status);
-- Hot path for the cron tick: "find me schedules whose next run is
-- due, across every org". Partial so the lookup is constant-time.
CREATE INDEX scheduled_reports_due_idx
  ON scheduled_reports (next_run_at)
  WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_reports TO authenticated;
ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduled_reports_tenant ON scheduled_reports
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- scheduled_report_runs ------------------------------------------------

CREATE TABLE scheduled_report_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheduled_report_id      uuid NOT NULL REFERENCES scheduled_reports(id) ON DELETE CASCADE,
  status                   scheduled_report_run_status NOT NULL DEFAULT 'queued',
  generated_at             timestamptz,
  sent_at                  timestamptz,
  html_size_bytes          integer,
  recipients_count         integer NOT NULL DEFAULT 0,
  error_message            text,
  error_code               text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scheduled_report_runs_report_idx
  ON scheduled_report_runs (scheduled_report_id, created_at DESC);
CREATE INDEX scheduled_report_runs_org_status_idx
  ON scheduled_report_runs (organization_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_report_runs TO authenticated;
ALTER TABLE scheduled_report_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduled_report_runs_tenant ON scheduled_report_runs
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
