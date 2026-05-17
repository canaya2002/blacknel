-- ---------------------------------------------------------------------------
-- 0020_enterprise_networks.sql — Phase 10 / Commit 38
--
-- Enterprise Networks — opens hospitality / legal / e-commerce
-- verticales with 5 platform connectors: Yelp, TripAdvisor,
-- Trustpilot, BBB, Avvo. Schema already supported these via the
-- `PlatformCode` enum since Phase 3; this commit lands the
-- per-platform extension surface.
--
-- # Charter touch on reviews (Phase 5)
--
-- ALTER reviews ADD COLUMN `platform_specific jsonb` nullable.
-- D-38-1 (a) — single jsonb column captures per-platform fields
-- that don't need querying (visualization-only). The strict
-- **render-only rule** is documented in `lib/db/schema/reviews.ts`
-- and `doc/PATTERNS.md`:
--
--   platform_specific is for RENDER ONLY. NO WHERE, NO GROUP BY,
--   NO index dependencies. When a field becomes query-relevant,
--   promote to a typed column via dedicated migration.
--
-- This rule prevents jsonb sprawl. Anti-Drupal-pattern by policy.
-- Aditive nullable column → cero impacto en rows históricos
-- Phase 5.
-- ---------------------------------------------------------------------------

ALTER TABLE reviews
  ADD COLUMN platform_specific jsonb;

-- NO index — `platform_specific` is render-only. If/when a
-- specific field becomes queryable, the migration that promotes
-- it adds the column + index together.
