-- ---------------------------------------------------------------------------
-- 0021_custom_reports.sql — Phase 10 / Commit 39
--
-- Custom Report Builder — Enterprise-tier feature. Drag-drop dashboard
-- builder with 5 widget kinds (kpi_card, table, sparkline,
-- distribution_chart, text_block). Plan gate: `customReports = true`
-- + `maxCustomReportsPerOrg = 50` cap (Standard/Growth: 0).
--
-- # Model split (D-39-6 b)
--
-- Two tables:
--   1. `custom_reports`         — report metadata + share scope.
--   2. `custom_report_widgets`  — widget instances. Position
--                                 lives HERE only (single source
--                                 of truth).
--
-- `custom_reports.layout jsonb` carries grid-level metadata that
-- is NOT per-widget (theme, gap_size, header_collapsed). It does
-- NOT duplicate widget positions. **Strict render-only rule
-- inherited from C38** — no index, no WHERE clause, no GROUP BY.
-- When a layout field becomes query-relevant, promote to typed
-- column via dedicated migration.
--
-- # Audit cadence (D-39-10 a)
--
-- Server Actions emit audit events ONLY on status transitions:
-- created / published / archived / shared. Layout edits and
-- widget config updates do NOT emit audit (would spam the trail
-- during normal drag-drop authoring).
--
-- # Validation strictness (D-39-7 a)
--
-- `publishCustomReportAction` is the boundary. Draft reports
-- accept overlapping widgets; publish runs
-- `lib/custom-reports/layout-validate.ts` and rejects if any
-- widget overlaps or escapes the 12-col grid.
-- ---------------------------------------------------------------------------

-- ---- ENUMS ----------------------------------------------------------------
-- See lib/db/schema/_enums.ts. Drizzle does NOT emit CREATE TYPE
-- when the enum is declared via pgEnum — we declare them inline
-- here, matching the Phase 10 pattern (0018, 0019, 0020).

CREATE TYPE custom_report_status AS ENUM ('draft', 'published', 'archived');

CREATE TYPE custom_report_widget_kind AS ENUM (
  'kpi_card',
  'table',
  'sparkline',
  'distribution_chart',
  'text_block'
);

CREATE TYPE custom_report_share_scope AS ENUM (
  'private',
  'org_visible',
  'specific_users'
);

-- ---- custom_reports table -------------------------------------------------

CREATE TABLE custom_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id          uuid REFERENCES brands(id) ON DELETE SET NULL,
  name              text NOT NULL,
  description       text,
  status            custom_report_status NOT NULL DEFAULT 'draft',
  layout            jsonb,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  share_scope       custom_report_share_scope NOT NULL DEFAULT 'private',
  shared_with       uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz,
  archived_at       timestamptz,
  CONSTRAINT custom_reports_name_length
    CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT custom_reports_published_has_timestamp
    CHECK (status <> 'published' OR published_at IS NOT NULL),
  CONSTRAINT custom_reports_archived_has_timestamp
    CHECK (status <> 'archived' OR archived_at IS NOT NULL)
);

CREATE INDEX custom_reports_org_status_idx
  ON custom_reports (organization_id, status);
CREATE INDEX custom_reports_org_created_idx
  ON custom_reports (organization_id, created_at DESC);
CREATE INDEX custom_reports_org_creator_idx
  ON custom_reports (organization_id, created_by);
-- NO index on `layout` — render-only rule.

GRANT SELECT, INSERT, UPDATE, DELETE ON custom_reports TO authenticated;
ALTER TABLE custom_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_reports_tenant ON custom_reports
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- custom_report_widgets table -----------------------------------------

CREATE TABLE custom_report_widgets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_report_id  uuid NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
  kind              custom_report_widget_kind NOT NULL,
  position_row      integer NOT NULL,
  position_col      integer NOT NULL,
  width             integer NOT NULL DEFAULT 1,
  height            integer NOT NULL DEFAULT 1,
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order     integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT widget_position_row_nonneg
    CHECK (position_row >= 0),
  CONSTRAINT widget_position_col_in_grid
    CHECK (position_col >= 0 AND position_col < 12),
  CONSTRAINT widget_width_positive
    CHECK (width >= 1 AND width <= 12),
  CONSTRAINT widget_height_positive
    CHECK (height >= 1 AND height <= 8),
  CONSTRAINT widget_position_fits_grid
    CHECK (position_col + width <= 12)
);

CREATE INDEX custom_report_widgets_report_idx
  ON custom_report_widgets (custom_report_id);
CREATE INDEX custom_report_widgets_report_order_idx
  ON custom_report_widgets (custom_report_id, position_row, position_col);

GRANT SELECT, INSERT, UPDATE, DELETE ON custom_report_widgets TO authenticated;
ALTER TABLE custom_report_widgets ENABLE ROW LEVEL SECURITY;

-- Widgets inherit tenancy via the parent custom_report. The policy
-- joins back to custom_reports so RLS evaluates exactly one source
-- of truth for org membership.
CREATE POLICY custom_report_widgets_tenant ON custom_report_widgets
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM custom_reports r
      WHERE r.id = custom_report_widgets.custom_report_id
        AND r.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM custom_reports r
      WHERE r.id = custom_report_widgets.custom_report_id
        AND r.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    )
  );

COMMENT ON TABLE custom_reports IS
  'Phase 10 / Commit 39 — Enterprise-only Custom Report Builder.
   Drag-drop dashboards with 5 widget kinds. layout jsonb carries
   grid-level metadata only (theme, gap, header state) under
   strict render-only rule. Widget positions live on
   custom_report_widgets, not here.';

COMMENT ON TABLE custom_report_widgets IS
  'Phase 10 / Commit 39 — widget instances inside a custom_report.
   Single source of truth for widget positions (NOT duplicated
   in custom_reports.layout). config jsonb is per-kind; validated
   by Zod schemas in lib/custom-reports/validate.ts.';
