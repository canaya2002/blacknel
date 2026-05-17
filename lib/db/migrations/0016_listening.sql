-- ---------------------------------------------------------------------------
-- 0016_listening.sql — Phase 9 / Commit 33
--
-- Social listening (Growth-tier feature). Two new tables + a charter
-- touch on `inbox_threads` (Phase 4):
--
--   * `listening_tracked_terms` — what the org is watching. One row
--     per `(org, brand, term)` — a brand can track multiple terms,
--     and a term can scope to a single brand or to all (brand_id
--     nullable).
--
--   * `listening_mentions`     — captured mentions. Sentiment is
--     reused from the existing `inbox_sentiment` enum (Phase 4).
--     `is_lead` is the AI-intent-derived "this is a sales prospect"
--     flag. `assigned_thread_id` points at an `inbox_threads` row
--     when a manager has converted the mention into an inbox
--     conversation.
--
--   * ALTER `inbox_threads` — adds `source_mention_id` (nullable
--     FK ON DELETE SET NULL) + partial index. Habilita el loop
--     discover → triage → operate exclusivo de Listening Growth
--     tier. Same anti-Drupal pattern + same null-default footprint
--     as `inbox_messages.whatsapp_template_id` (Commit 31). Column
--     nullable sin default → no afecta inserts existentes ni rows
--     históricos.
--
-- Both FKs cross between the two tables — handled by adding the
-- FK constraints in a third step after both tables exist.
--
-- Decisions D-33-1..5 + R-33-1 + R-33-2 documented in CHANGELOG.
-- ---------------------------------------------------------------------------

-- ---- ENUMS ----------------------------------------------------------------

CREATE TYPE listening_term_kind AS ENUM (
  'keyword',
  'hashtag',
  'handle'
);

CREATE TYPE listening_term_status AS ENUM (
  'active',
  'paused',
  'archived'
);

CREATE TYPE listening_mention_kind AS ENUM (
  'post',
  'comment',
  'share',
  'repost'
);

CREATE TYPE listening_mention_status AS ENUM (
  'new',
  'triaged',
  'archived',
  'converted'
);

-- ---- listening_tracked_terms ---------------------------------------------

CREATE TABLE listening_tracked_terms (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id                 uuid REFERENCES brands(id) ON DELETE SET NULL,
  term                     text NOT NULL,
  term_kind                listening_term_kind NOT NULL,
  -- D-33-1 (a) — connector-driven listening. `platforms` array
  -- carries the platform-code keys (facebook/instagram/x/reddit
  -- in Phase 9 mock; expandible without ALTER).
  platforms                text[] NOT NULL,
  status                   listening_term_status NOT NULL DEFAULT 'active',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz,
  CONSTRAINT listening_tracked_terms_platforms_nonempty
    CHECK (cardinality(platforms) >= 1),
  CONSTRAINT listening_tracked_terms_unique
    UNIQUE (organization_id, brand_id, term, term_kind)
);

CREATE INDEX listening_tracked_terms_org_status_idx
  ON listening_tracked_terms (organization_id, status);
CREATE INDEX listening_tracked_terms_active_idx
  ON listening_tracked_terms (organization_id)
  WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON listening_tracked_terms TO authenticated;
ALTER TABLE listening_tracked_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY listening_tracked_terms_tenant ON listening_tracked_terms
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- listening_mentions --------------------------------------------------

CREATE TABLE listening_mentions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tracked_term_id          uuid NOT NULL REFERENCES listening_tracked_terms(id) ON DELETE CASCADE,
  brand_id                 uuid REFERENCES brands(id) ON DELETE SET NULL,
  platform                 text NOT NULL,
  external_id              text NOT NULL,
  author_handle            text NOT NULL,
  author_display_name      text,
  body                     text NOT NULL,
  url                      text,
  kind                     listening_mention_kind NOT NULL DEFAULT 'post',
  sentiment                inbox_sentiment NOT NULL DEFAULT 'unknown',
  -- AI confidence ∈ [0, 1]. Stored as numeric so rounding doesn't
  -- leak through float ops on the analytics side.
  sentiment_score          numeric(3, 2) NOT NULL DEFAULT 0,
  is_lead                  boolean NOT NULL DEFAULT false,
  status                   listening_mention_status NOT NULL DEFAULT 'new',
  captured_at              timestamptz NOT NULL DEFAULT now(),
  -- assigned_thread_id FK to inbox_threads added below (circular —
  -- inbox_threads.source_mention_id FK to listening_mentions).
  assigned_thread_id       uuid,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listening_mentions_sentiment_score_range
    CHECK (sentiment_score >= 0 AND sentiment_score <= 1),
  CONSTRAINT listening_mentions_external_unique
    UNIQUE (organization_id, platform, external_id)
);

CREATE INDEX listening_mentions_org_status_captured_idx
  ON listening_mentions (organization_id, status, captured_at DESC);
CREATE INDEX listening_mentions_org_lead_idx
  ON listening_mentions (organization_id, is_lead, captured_at DESC)
  WHERE is_lead = true;
CREATE INDEX listening_mentions_brand_status_idx
  ON listening_mentions (brand_id, status);
CREATE INDEX listening_mentions_tracked_term_idx
  ON listening_mentions (tracked_term_id, captured_at DESC);
CREATE INDEX listening_mentions_assigned_thread_idx
  ON listening_mentions (assigned_thread_id)
  WHERE assigned_thread_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON listening_mentions TO authenticated;
ALTER TABLE listening_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY listening_mentions_tenant ON listening_mentions
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- ALTER inbox_threads (Phase-4 charter touch) -------------------------
-- Justificación R-33-2: column tipada source_mention_id (NOT
-- metadata.source_mention_id jsonb genérico). Habilita el loop
-- discover→triage→operate exclusivo de Listening Growth tier. Mismo
-- patrón que `inbox_messages.whatsapp_template_id` (Commit 31).
-- Column nullable, sin default, FK ON DELETE SET NULL → no afecta
-- rows históricos de Phase 4 ni altera inserts existentes que no
-- setean el campo. Partial index restringe el storage al subset
-- de threads de origen listening (~5-15% estimado).

ALTER TABLE inbox_threads
  ADD COLUMN source_mention_id uuid
    REFERENCES listening_mentions(id) ON DELETE SET NULL;

CREATE INDEX inbox_threads_source_mention_idx
  ON inbox_threads (source_mention_id)
  WHERE source_mention_id IS NOT NULL;

-- ---- ALTER listening_mentions FK (circular) ------------------------------
-- Resolves the circular reference: both tables exist, so we can now
-- add the FK from `listening_mentions.assigned_thread_id` →
-- `inbox_threads.id`. Both sides ON DELETE SET NULL — neither row's
-- deletion cascades into the other side, just nulls the pointer.

ALTER TABLE listening_mentions
  ADD CONSTRAINT listening_mentions_assigned_thread_fk
    FOREIGN KEY (assigned_thread_id)
    REFERENCES inbox_threads(id)
    ON DELETE SET NULL;
