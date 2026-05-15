-- =============================================================================
-- 0001_schema.sql — Tables, enums, foreign keys, indexes (Phase 1).
-- =============================================================================
-- Mirrors the Drizzle schema under `lib/db/schema/`. Hand-written rather
-- than `drizzle-kit generate` so we can co-locate RLS, triggers, and roles
-- in the same migration tree and apply them in one ordered sweep.
--
-- If you change `lib/db/schema/*.ts`, change this file too. Drift between
-- the two surfaces will quietly break queries.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums (Postgres native types)
-- ---------------------------------------------------------------------------

CREATE TYPE organization_status AS ENUM ('active', 'suspended', 'archived');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'manager', 'agent', 'viewer');
CREATE TYPE member_status AS ENUM ('active', 'invited', 'suspended');
CREATE TYPE plan_code AS ENUM ('standard', 'growth', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'paused', 'trialing');
CREATE TYPE brand_status AS ENUM ('active', 'archived');
CREATE TYPE location_status AS ENUM ('active', 'archived');
CREATE TYPE audit_actor_type AS ENUM ('user', 'ai', 'system', 'automation');

-- ---------------------------------------------------------------------------
-- plans — global pricing table
-- ---------------------------------------------------------------------------

CREATE TABLE plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            plan_code NOT NULL UNIQUE,
  name            text NOT NULL,
  price_cents     integer NOT NULL,
  limits          jsonb NOT NULL DEFAULT '{}'::jsonb,
  features        jsonb NOT NULL DEFAULT '{}'::jsonb,
  stripe_price_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- users — mirror of auth.users. `id` is set by the auth trigger.
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                      uuid PRIMARY KEY,
  email                   text NOT NULL,
  name                    text,
  avatar_url              text,
  locale                  text NOT NULL DEFAULT 'en',
  default_organization_id uuid,           -- FK added after organizations exists
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON users (email);

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  plan_id       uuid REFERENCES plans(id) ON DELETE RESTRICT,
  created_by    uuid,                       -- FK added below (circular)
  billing_email text,
  country       text NOT NULL DEFAULT 'US',
  locale        text NOT NULL DEFAULT 'en',
  timezone      text NOT NULL DEFAULT 'UTC',
  status        organization_status NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organizations_slug_idx ON organizations (slug);
CREATE INDEX organizations_status_idx ON organizations (status);

-- Close the users ↔ organizations cycle now that both exist.
ALTER TABLE users
  ADD CONSTRAINT users_default_organization_fk
  FOREIGN KEY (default_organization_id)
  REFERENCES organizations(id)
  ON DELETE SET NULL;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_created_by_fk
  FOREIGN KEY (created_by)
  REFERENCES users(id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------

CREATE TABLE organization_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            member_role NOT NULL,
  status          member_status NOT NULL DEFAULT 'active',
  invited_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  invited_at      timestamptz,
  joined_at       timestamptz DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organization_members_org_user_unique
  ON organization_members (organization_id, user_id);
CREATE INDEX organization_members_user_idx ON organization_members (user_id);
CREATE INDEX organization_members_org_status_idx
  ON organization_members (organization_id, status);

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------

CREATE TABLE invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           text NOT NULL,
  role            member_role NOT NULL,
  token           text NOT NULL,
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  accepted_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  invited_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_token_unique ON invitations (token);
CREATE INDEX invitations_org_email_idx ON invitations (organization_id, email);

-- ---------------------------------------------------------------------------
-- brand_voices  (needed before brands FK)
-- ---------------------------------------------------------------------------

CREATE TABLE brand_voices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  tone            text,
  style           text,
  allowed_emojis  jsonb NOT NULL DEFAULT '[]'::jsonb,
  forbidden_words jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_words jsonb NOT NULL DEFAULT '[]'::jsonb,
  languages       jsonb NOT NULL DEFAULT '["en"]'::jsonb,
  ctas            jsonb NOT NULL DEFAULT '[]'::jsonb,
  disclaimers     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_voices_org_idx ON brand_voices (organization_id);

-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------

CREATE TABLE brands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  logo_url        text,
  brand_voice_id  uuid REFERENCES brand_voices(id) ON DELETE SET NULL,
  status          brand_status NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX brands_org_slug_unique ON brands (organization_id, slug);
CREATE INDEX brands_org_status_idx ON brands (organization_id, status);

-- ---------------------------------------------------------------------------
-- locations
-- ---------------------------------------------------------------------------

CREATE TABLE locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id        uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name            text NOT NULL,
  address         text,
  city            text,
  state           text,
  country         text,
  timezone        text,
  phone           text,
  gbp_place_id    text,
  status          location_status NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locations_org_idx ON locations (organization_id);
CREATE INDEX locations_brand_idx ON locations (brand_id);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id                uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status                 subscription_status NOT NULL DEFAULT 'active',
  stripe_subscription_id text,
  current_period_end     timestamptz,
  cancel_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_org_idx ON subscriptions (organization_id);
CREATE INDEX subscriptions_stripe_idx ON subscriptions (stripe_subscription_id);
-- Partial unique: at most one *active* subscription per org. Canceled
-- rows are kept as history and don't block new active rows.
CREATE UNIQUE INDEX subscriptions_org_active_unique
  ON subscriptions (organization_id)
  WHERE status IN ('active', 'trialing', 'past_due');

-- ---------------------------------------------------------------------------
-- usage_counters
-- ---------------------------------------------------------------------------

CREATE TABLE usage_counters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric          text NOT NULL,
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  value           bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usage_counters_org_metric_period_unique
  ON usage_counters (organization_id, metric, period_start);
CREATE INDEX usage_counters_org_metric_idx
  ON usage_counters (organization_id, metric);

-- ---------------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type      audit_actor_type NOT NULL DEFAULT 'user',
  action          text NOT NULL,
  entity_type     text,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  ip              text,
  user_agent      text,
  risk_level      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_created_idx ON audit_events (organization_id, created_at);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id);
CREATE INDEX audit_events_action_idx ON audit_events (action);
