-- ---------------------------------------------------------------------------
-- 0011_ai_cascade_linkage.sql — Phase 7 / Commit 23 (Ajuste 1 + 2)
--
-- Adds explicit causal linkage between a baseline `ai_generations`
-- row and its cascade (second-pass) sibling. Used by the
-- compliance cascade landing in this commit:
--
--   * Baseline call (Haiku) writes row A with
--     parent_generation_id = NULL.
--   * If `riskLevel ∈ {'high', 'critical'}`, the skill module
--     fires a second call (Opus) with the cascade system
--     prompt; that row B has parent_generation_id = A.id.
--
-- Shared `entity_id` alone couples the two rows by context but
-- doesn't express the *causal* relation. The new column lets
-- the budget dashboard answer:
--
--   - "What fraction of high-risk generations actually
--      triggered the Opus cascade?"
--      → cascade_rate = count(parent_id IS NOT NULL) /
--                       count(output->>'riskLevel' IN ('high','critical') AND parent_id IS NULL)
--   - "Show all cascades in the last 30 days":
--      → WHERE parent_generation_id IS NOT NULL
--
-- The partial index sits on `(organization_id,
-- parent_generation_id)` and is filtered to non-null parents.
-- Expected to cover ~20% of rows (only the cascades).
-- ---------------------------------------------------------------------------

ALTER TABLE ai_generations
  ADD COLUMN parent_generation_id uuid
  REFERENCES ai_generations(id) ON DELETE SET NULL;

CREATE INDEX ai_generations_parent_idx
  ON ai_generations (organization_id, parent_generation_id)
  WHERE parent_generation_id IS NOT NULL;
