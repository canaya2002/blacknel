-- ---------------------------------------------------------------------------
-- 0010_ai_infrastructure.sql — Phase 7 / Commit 22
--
-- Lands the persistence layer for the Claude SDK adapter. Two
-- tables + four enums + RLS policies. The adapter (mock today,
-- real in Phase 11) writes one `ai_generations` row per
-- inference call; surfaces in dashboards / budget alerts /
-- audit trails consume from there.
--
-- The schema is intentionally generous on `input` / `output`
-- jsonb shapes — every skill stores its own contract. Stable
-- indexed columns (org, skill, model, hash, entity_*) are the
-- query keys; jsonb is the audit / debug surface.
--
-- `ai_recommendations` is the higher-level surface for AI-driven
-- suggestions that have a lifecycle (pending → accepted / dismissed).
-- Commit 22 creates the table; Commits 24-25 wire crisis recs +
-- brand-voice recs against it.
-- ---------------------------------------------------------------------------

-- ---- ENUMS ----------------------------------------------------------------

CREATE TYPE ai_actor_type AS ENUM ('user', 'system');

CREATE TYPE ai_skill AS ENUM (
  'compliance',
  'caption',
  'review_response',
  'language_detect',
  'sentiment',
  'intent',
  'crisis',
  'thread_summary',
  'review_summary'
);

CREATE TYPE ai_rec_category AS ENUM (
  'crisis',
  'brand_voice_tone',
  'response_template',
  'audience_insight'
);

CREATE TYPE ai_rec_status AS ENUM ('pending', 'accepted', 'dismissed');

-- ---- ai_generations -------------------------------------------------------

CREATE TABLE ai_generations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Nullable: system path (cron-driven crisis scan) doesn't have a user.
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type          ai_actor_type NOT NULL,
  skill               ai_skill NOT NULL,
  model               text NOT NULL,
  -- sha256 of (skill | model | systemPrompt | userPrompt | JSON.stringify(input)).
  -- Drives the 5-min dedup lookup AND prompt-cache analytics.
  request_hash        text NOT NULL,
  input_tokens        integer NOT NULL DEFAULT 0,
  cached_input_tokens integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  cost_cents          integer NOT NULL DEFAULT 0,
  duration_ms         integer NOT NULL DEFAULT 0,
  -- True when adapter returned a previously-cached output via the
  -- 5-min dedup window (NOT the same as cached_input_tokens, which
  -- is the prompt-cache hit count from Anthropic).
  cache_hit           boolean NOT NULL DEFAULT false,
  entity_type         text NOT NULL,
  entity_id           uuid,
  input               jsonb NOT NULL DEFAULT '{}'::jsonb,
  output              jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code          text,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Budget / dashboard query: most recent generations per org.
CREATE INDEX ai_generations_org_created_idx
  ON ai_generations (organization_id, created_at DESC);

-- Dedup lookup: same hash inside the 5-min window returns the
-- cached output without a fresh adapter call.
CREATE INDEX ai_generations_hash_idx
  ON ai_generations (organization_id, request_hash, created_at DESC);

-- "Show me all AI generations for this thread / review / post".
CREATE INDEX ai_generations_entity_idx
  ON ai_generations (entity_type, entity_id, skill);

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_generations TO authenticated;
ALTER TABLE ai_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_generations_tenant ON ai_generations
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- ai_recommendations ---------------------------------------------------

CREATE TABLE ai_recommendations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id            uuid REFERENCES brands(id) ON DELETE SET NULL,
  category            ai_rec_category NOT NULL,
  title               text NOT NULL,
  body                text NOT NULL,
  status              ai_rec_status NOT NULL DEFAULT 'pending',
  evidence            jsonb NOT NULL DEFAULT '{}'::jsonb,
  generation_id       uuid REFERENCES ai_generations(id) ON DELETE SET NULL,
  decided_at          timestamptz,
  decided_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_recommendations_org_status_idx
  ON ai_recommendations (organization_id, status, created_at DESC);

CREATE INDEX ai_recommendations_generation_idx
  ON ai_recommendations (generation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_recommendations TO authenticated;
ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_recommendations_tenant ON ai_recommendations
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
