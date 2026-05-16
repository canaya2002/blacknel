-- ---------------------------------------------------------------------------
-- 0007_publishing.sql — Phase 6 / Commit 17
--
-- Adds the four publishing tables:
--
--   * campaigns          — marketing campaigns (org-scoped containers for posts)
--   * content_assets     — asset library (images / videos / pdfs / gifs)
--   * posts              — logical post intent (one row per "publish X to N accounts")
--   * post_targets       — per-(post, connected_account) dispatch row
--
-- Design notes:
--
--   * `post_targets.organization_id` is denormalized + auto-filled by a
--     BEFORE INSERT trigger reading from the parent post. Same pattern as
--     `inbox_messages` (0005) and `review_responses` (0006). Drizzle's
--     insert type can't model the trigger so callers pass it explicitly
--     when they have it; the trigger is defense-in-depth for seeds and
--     dev tools.
--
--   * Two independent partial unique constraints around idempotency:
--       1. `posts (organization_id, idempotency_key) WHERE NOT NULL`
--          — prevents double-schedule from a double-clicked button.
--       2. `post_targets (post_id, idempotency_key) WHERE NOT NULL`
--          — prevents job re-runs duplicating per-account dispatches.
--
--   * `post_targets (post_id, connected_account_id) WHERE status != 'failed'`
--     is a partial unique that enforces "one successful or in-flight
--     target per (post, account)" while letting failed retries pile up
--     for audit. Postgres accepts arbitrary `WHERE` predicates on
--     partial uniques.
--
--   * `posts.status='publishing'` is a transitory state. If the
--     publish-job crashes mid-flight, rows can stick there. Phase-6
--     local Inngest lacks the auto-recovery a real Inngest cluster
--     gives — tracked at TODO.md#publishing-stuck-recovery (added at
--     Commit 20 when the job lands).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE post_status AS ENUM (
  'draft',
  'pending_approval',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled'
);

CREATE TYPE post_target_status AS ENUM (
  'pending',
  'publishing',
  'published',
  'failed'
);

CREATE TYPE campaign_goal AS ENUM (
  'awareness',
  'engagement',
  'leads',
  'reviews',
  'reputation',
  'event',
  'launch',
  'promotion',
  'education',
  'crisis',
  'seasonal',
  'evergreen'
);

CREATE TYPE campaign_status AS ENUM (
  'draft',
  'active',
  'paused',
  'completed',
  'archived'
);

CREATE TYPE content_asset_kind AS ENUM (
  'image',
  'video',
  'pdf',
  'gif'
);

-- ---------------------------------------------------------------------------
-- campaigns — logical containers; posts FK into here
-- ---------------------------------------------------------------------------

CREATE TABLE campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id        uuid REFERENCES brands(id) ON DELETE SET NULL,
  name            text NOT NULL,
  goal            campaign_goal NOT NULL DEFAULT 'evergreen',
  status          campaign_status NOT NULL DEFAULT 'draft',
  starts_at       timestamptz,
  ends_at         timestamptz,
  owner_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  budget_cents    integer,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_org_status_idx ON campaigns (organization_id, status);
CREATE INDEX campaigns_org_brand_idx  ON campaigns (organization_id, brand_id);

-- ---------------------------------------------------------------------------
-- content_assets — library of uploaded media
-- ---------------------------------------------------------------------------

CREATE TABLE content_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id        uuid REFERENCES brands(id) ON DELETE SET NULL,
  kind            content_asset_kind NOT NULL,
  url             text NOT NULL,
  thumbnail_url   text,
  name            text NOT NULL,
  tags            jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at      timestamptz,
  approved        boolean NOT NULL DEFAULT true,
  uploaded_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  used_count      integer NOT NULL DEFAULT 0,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_assets_org_kind_idx     ON content_assets (organization_id, kind);
CREATE INDEX content_assets_org_brand_idx    ON content_assets (organization_id, brand_id);
CREATE INDEX content_assets_org_approved_idx ON content_assets (organization_id, approved);

-- ---------------------------------------------------------------------------
-- posts — logical post intent
-- ---------------------------------------------------------------------------

CREATE TABLE posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id         uuid REFERENCES brands(id) ON DELETE SET NULL,
  campaign_id      uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  author_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  status           post_status NOT NULL DEFAULT 'draft',
  text             text NOT NULL DEFAULT '',
  media_ids        jsonb NOT NULL DEFAULT '[]'::jsonb,
  link             text,
  utm              jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at     timestamptz,
  published_at     timestamptz,
  idempotency_key  text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX posts_org_status_idx    ON posts (organization_id, status);
CREATE INDEX posts_org_scheduled_idx ON posts (organization_id, scheduled_at);
CREATE INDEX posts_org_campaign_idx  ON posts (organization_id, campaign_id);

CREATE UNIQUE INDEX posts_org_idempotency_unique
  ON posts (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- post_targets — per-(post, connected_account) dispatch
-- ---------------------------------------------------------------------------

CREATE TABLE post_targets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  post_id               uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  connected_account_id  uuid NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform_variant      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                post_target_status NOT NULL DEFAULT 'pending',
  external_post_id      text,
  published_at          timestamptz,
  error_message         text,
  attempt_count         integer NOT NULL DEFAULT 0,
  idempotency_key       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX post_targets_post_idx       ON post_targets (post_id);
CREATE INDEX post_targets_account_idx    ON post_targets (connected_account_id);
CREATE INDEX post_targets_org_status_idx ON post_targets (organization_id, status);

-- One successful or in-flight target per (post, account). `'failed'`
-- rows are exempt so retry history can accumulate.
CREATE UNIQUE INDEX post_targets_post_account_active_unique
  ON post_targets (post_id, connected_account_id)
  WHERE status <> 'failed';

-- Defends against publish-job re-runs duplicating dispatch rows.
CREATE UNIQUE INDEX post_targets_post_idempotency_unique
  ON post_targets (post_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Auto-set organization_id from the parent post. SECURITY INVOKER
-- (default) so the SELECT against posts honors the caller's RLS —
-- a cross-tenant post_id resolves to no row, organization_id stays
-- NULL, and the NOT NULL constraint rejects the insert.
CREATE OR REPLACE FUNCTION public.post_targets_set_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM posts WHERE id = NEW.post_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_post_targets_set_org
  BEFORE INSERT ON post_targets
  FOR EACH ROW EXECUTE FUNCTION public.post_targets_set_org_id();

-- ---------------------------------------------------------------------------
-- updated_at triggers (touch_updated_at function defined in 0003)
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_campaigns_touch_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_content_assets_touch_updated_at
  BEFORE UPDATE ON content_assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_posts_touch_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_post_targets_touch_updated_at
  BEFORE UPDATE ON post_targets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO authenticated;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaigns_tenant ON campaigns
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON content_assets TO authenticated;
ALTER TABLE content_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY content_assets_tenant ON content_assets
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON posts TO authenticated;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY posts_tenant ON posts
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON post_targets TO authenticated;
ALTER TABLE post_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY post_targets_tenant ON post_targets
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
