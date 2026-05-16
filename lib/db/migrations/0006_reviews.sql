-- =============================================================================
-- 0006_reviews.sql — reviews + responses + requests + reputation snapshots.
-- =============================================================================
-- Phase 5 adds the public-review surface plus the review-request flow.
--
-- Design notes mirroring Phase 4:
--
--   * `reviews.sentiment` reuses the existing `inbox_sentiment` enum
--     from 0005 — the 4-value classifier vocabulary is shared across
--     Blacknel modules.
--
--   * `review_responses.organization_id` is denormalized on the row +
--     auto-filled by BEFORE INSERT trigger from `reviews.organization_id`.
--     Same pattern as `inbox_messages` in 0005.
--
--   * `review_requests.token` is globally unique — the public landing
--     `/feedback/[token]` knows nothing about the org. Token format is
--     enforced at the application layer (see `lib/reviews/public-feedback.ts`).
--
--   * `reputation_snapshots` is a daily roll-up with `(org, location,
--     platform, date)` uniqueness so the nightly job can re-run safely.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE review_status AS ENUM (
  'pending', 'in_progress', 'responded', 'archived', 'spam'
);
CREATE TYPE review_response_status AS ENUM (
  'draft', 'pending_approval', 'approved', 'published', 'rejected'
);
CREATE TYPE review_request_channel AS ENUM ('email', 'sms', 'whatsapp', 'qr');
CREATE TYPE review_request_outcome AS ENUM (
  'positive_routed', 'negative_captured', 'no_response', 'expired'
);

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------

CREATE TABLE reviews (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id               uuid REFERENCES brands(id) ON DELETE SET NULL,
  location_id            uuid REFERENCES locations(id) ON DELETE SET NULL,
  connected_account_id   uuid REFERENCES connected_accounts(id) ON DELETE SET NULL,
  platform               text NOT NULL,
  external_review_id     text,
  author_name            text,
  author_avatar          text,
  rating                 integer NOT NULL,
  body                   text NOT NULL DEFAULT '',
  language               text,
  posted_at              timestamptz NOT NULL DEFAULT now(),
  sentiment              inbox_sentiment NOT NULL DEFAULT 'unknown',
  status                 review_status NOT NULL DEFAULT 'pending',
  assigned_to            uuid REFERENCES users(id) ON DELETE SET NULL,
  escalated              boolean NOT NULL DEFAULT false,
  tags                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5)
);

CREATE INDEX reviews_org_status_idx ON reviews (organization_id, status);
CREATE INDEX reviews_org_posted_idx ON reviews (organization_id, posted_at DESC);
CREATE INDEX reviews_org_location_idx ON reviews (organization_id, location_id);
CREATE INDEX reviews_org_platform_idx ON reviews (organization_id, platform);
CREATE INDEX reviews_org_rating_idx ON reviews (organization_id, rating);
CREATE INDEX reviews_org_assigned_idx ON reviews (organization_id, assigned_to);
CREATE UNIQUE INDEX reviews_org_platform_external_unique
  ON reviews (organization_id, platform, external_review_id)
  WHERE external_review_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- review_responses — organization_id denormalized via BEFORE INSERT trigger
-- ---------------------------------------------------------------------------

CREATE TABLE review_responses (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_id              uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  draft_text             text,
  final_text             text,
  status                 review_response_status NOT NULL DEFAULT 'draft',
  author_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  ai_generated           boolean NOT NULL DEFAULT false,
  compliance_score       integer,
  published_at           timestamptz,
  external_response_id   text,
  idempotency_key        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_responses_compliance_score_check
    CHECK (compliance_score IS NULL OR (compliance_score BETWEEN 0 AND 100))
);

CREATE INDEX review_responses_review_idx ON review_responses (review_id);
CREATE INDEX review_responses_org_status_idx ON review_responses (organization_id, status);
CREATE UNIQUE INDEX review_responses_review_idempotency_unique
  ON review_responses (review_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.review_responses_set_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM reviews WHERE id = NEW.review_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_review_responses_set_org
  BEFORE INSERT ON review_responses
  FOR EACH ROW EXECUTE FUNCTION public.review_responses_set_org_id();

-- ---------------------------------------------------------------------------
-- review_requests — public-token table with global token uniqueness
-- ---------------------------------------------------------------------------

CREATE TABLE review_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id        uuid REFERENCES brands(id) ON DELETE SET NULL,
  location_id     uuid REFERENCES locations(id) ON DELETE SET NULL,
  channel         review_request_channel NOT NULL,
  contact_info    jsonb NOT NULL DEFAULT '{}'::jsonb,
  token           text NOT NULL,
  sent_at         timestamptz,
  opened_at       timestamptz,
  completed_at    timestamptz,
  outcome         review_request_outcome,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX review_requests_token_unique ON review_requests (token);
CREATE INDEX review_requests_org_sent_idx ON review_requests (organization_id, sent_at);
CREATE INDEX review_requests_org_location_idx
  ON review_requests (organization_id, location_id);

-- ---------------------------------------------------------------------------
-- reputation_snapshots — daily roll-up per (location, platform)
-- ---------------------------------------------------------------------------

CREATE TABLE reputation_snapshots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id          uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  platform             text NOT NULL,
  date                 date NOT NULL,
  rating_avg           numeric(3, 2),
  review_count         integer NOT NULL DEFAULT 0,
  response_rate        numeric(5, 2),
  sentiment_breakdown  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reputation_snapshots_org_date_idx
  ON reputation_snapshots (organization_id, date DESC);
CREATE UNIQUE INDEX reputation_snapshots_org_location_platform_date_unique
  ON reputation_snapshots (organization_id, location_id, platform, date);

-- ---------------------------------------------------------------------------
-- updated_at triggers (touch_updated_at defined in 0003)
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_reviews_touch_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_review_responses_touch_updated_at
  BEFORE UPDATE ON review_responses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_review_requests_touch_updated_at
  BEFORE UPDATE ON review_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- `reputation_snapshots` is append-only (no updated_at column).

-- ---------------------------------------------------------------------------
-- RLS — every table carries organization_id directly; policies are
-- single-column equality checks. No subqueries.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON reviews TO authenticated;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_tenant ON reviews
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON review_responses TO authenticated;
ALTER TABLE review_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_responses_tenant ON review_responses
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON review_requests TO authenticated;
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_requests_tenant ON review_requests
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON reputation_snapshots TO authenticated;
ALTER TABLE reputation_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY reputation_snapshots_tenant ON reputation_snapshots
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
