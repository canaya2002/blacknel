-- ---------------------------------------------------------------------------
-- 0015_nps_surveys.sql — Phase 9 / Commit 32
--
-- Net Promoter Score (NPS) — Growth-tier feature. Three tables wire
-- the full lifecycle:
--
--   * `nps_surveys`      — per-org/brand config (trigger, channels,
--                          question_text, locale, status, throttle).
--   * `nps_invitations`  — one row per outbound send. Carries the
--                          public landing token + idempotency_key.
--   * `nps_responses`    — recorded submissions. `category` is a
--                          GENERATED column derived from `score` so
--                          insertion can never lie about the bucket
--                          (R-32-1 / D-32-6).
--
-- Decisions (see CHANGELOG Commit 32 for the full ledger):
--
--   D-32-1 (a)  bilingual ES/EN — `locale` per-survey + per-org default
--   D-32-3 (a)  detractor (score ≤ 6) responses require a comment —
--               CHECK constraint at DB layer (defense in depth)
--   D-32-4      `idempotency_key` is a dedicated nullable column with a
--               partial unique index (`WHERE NOT NULL`). Avoids the
--               `metadata->>'idempotency_key'` jsonb anti-pattern.
--   D-32-5      Per-day dedup uses a generated column `sent_on_date`
--               (NOT a functional index on `(sent_at::date)` because
--               `timestamptz::date` is STABLE — Postgres refuses such
--               an index expression as non-IMMUTABLE).
--   D-32-6      `category` derives from `score` via GENERATED ALWAYS
--               AS … STORED instead of a BEFORE-INSERT trigger.
--
-- Charter — no touches to Phases 1-7 schemas. All new tables.
-- ---------------------------------------------------------------------------

-- ---- ENUMS ----------------------------------------------------------------

CREATE TYPE nps_survey_trigger AS ENUM (
  'post_purchase',
  'post_resolution',
  'periodic',
  'manual'
);

CREATE TYPE nps_survey_channel AS ENUM (
  'email',
  'whatsapp',
  'sms_reserved'
);

CREATE TYPE nps_response_category AS ENUM (
  'promoter',
  'passive',
  'detractor'
);

CREATE TYPE nps_survey_status AS ENUM (
  'draft',
  'active',
  'paused',
  'archived'
);

-- ---- nps_surveys ----------------------------------------------------------

CREATE TABLE nps_surveys (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id                    uuid REFERENCES brands(id) ON DELETE SET NULL,
  name                        text NOT NULL,
  trigger                     nps_survey_trigger NOT NULL,
  channels                    nps_survey_channel[] NOT NULL,
  question_text               text NOT NULL,
  thank_you_message           text,
  locale                      text NOT NULL DEFAULT 'es',
  status                      nps_survey_status NOT NULL DEFAULT 'draft',
  min_days_between_sends      integer NOT NULL DEFAULT 90,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  archived_at                 timestamptz,
  CONSTRAINT nps_surveys_channels_nonempty
    CHECK (cardinality(channels) >= 1),
  CONSTRAINT nps_surveys_min_days_nonneg
    CHECK (min_days_between_sends >= 0)
);

CREATE INDEX nps_surveys_org_status_idx
  ON nps_surveys (organization_id, status);
CREATE INDEX nps_surveys_org_trigger_idx
  ON nps_surveys (organization_id, trigger)
  WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON nps_surveys TO authenticated;
ALTER TABLE nps_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY nps_surveys_tenant ON nps_surveys
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- nps_invitations ------------------------------------------------------

CREATE TABLE nps_invitations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nps_survey_id            uuid NOT NULL REFERENCES nps_surveys(id) ON DELETE CASCADE,
  brand_id                 uuid REFERENCES brands(id) ON DELETE SET NULL,
  contact_identifier       text NOT NULL,
  contact_name             text,
  channel                  nps_survey_channel NOT NULL,
  sent_at                  timestamptz NOT NULL DEFAULT now(),
  -- D-32-5 — generated UTC date for the per-day uniqueness index. Computed
  -- in UTC so timezone changes don't move the bucket boundary. The cast
  -- (sent_at AT TIME ZONE 'UTC')::date is IMMUTABLE.
  sent_on_date             date GENERATED ALWAYS AS
                              ((sent_at AT TIME ZONE 'UTC')::date) STORED,
  delivered_at             timestamptz,
  token                    text NOT NULL,
  expires_at               timestamptz NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  responded_at             timestamptz,
  idempotency_key          text,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nps_invitations_token_unique UNIQUE (token)
);

-- D-32-5 — one invitation per (org, survey, contact) per UTC day.
CREATE UNIQUE INDEX nps_invitations_one_per_day
  ON nps_invitations (organization_id, nps_survey_id, contact_identifier, sent_on_date);

-- D-32-4 — idempotency_key dedup. Partial unique so NULL inbound rows
-- don't collide. Phase-3 `inbox_messages.idempotency_key` uses the same
-- pattern.
CREATE UNIQUE INDEX nps_invitations_idempotency_unique
  ON nps_invitations (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Read paths: list by survey + contact (for the min_days_between_sends
-- check) and "find unresponded invitations expiring soon".
CREATE INDEX nps_invitations_survey_contact_sent_idx
  ON nps_invitations (nps_survey_id, contact_identifier, sent_at DESC);
CREATE INDEX nps_invitations_org_sent_idx
  ON nps_invitations (organization_id, sent_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON nps_invitations TO authenticated;
ALTER TABLE nps_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY nps_invitations_tenant ON nps_invitations
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- nps_responses --------------------------------------------------------

CREATE TABLE nps_responses (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nps_invitation_id        uuid NOT NULL REFERENCES nps_invitations(id) ON DELETE CASCADE,
  score                    integer NOT NULL,
  -- D-32-6 — category derives from score declaratively. No trigger, no
  -- way for app code to set the wrong bucket. Same pattern as
  -- `inbox_messages.search_tsv` (Phase 4).
  category                 nps_response_category GENERATED ALWAYS AS (
    CASE
      WHEN score >= 9 THEN 'promoter'::nps_response_category
      WHEN score >= 7 THEN 'passive'::nps_response_category
      ELSE 'detractor'::nps_response_category
    END
  ) STORED,
  comment                  text,
  responded_at             timestamptz NOT NULL DEFAULT now(),
  ip_address               inet,
  user_agent               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nps_responses_score_range CHECK (score >= 0 AND score <= 10),
  -- D-32-3 — detractors must include a comment. Soft pressure at the UI
  -- + hard guard here so a malicious bypass on /nps/[token] still cannot
  -- record a "silent" detractor.
  CONSTRAINT nps_responses_detractor_comment CHECK (
    score >= 7
    OR (comment IS NOT NULL AND length(btrim(comment)) > 0)
  ),
  CONSTRAINT nps_responses_one_per_invitation
    UNIQUE (nps_invitation_id)
);

CREATE INDEX nps_responses_org_responded_idx
  ON nps_responses (organization_id, responded_at DESC);
CREATE INDEX nps_responses_org_category_idx
  ON nps_responses (organization_id, category);

GRANT SELECT, INSERT, UPDATE, DELETE ON nps_responses TO authenticated;
ALTER TABLE nps_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY nps_responses_tenant ON nps_responses
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
