-- =============================================================================
-- 0005_inbox.sql — inbox + approvals.
-- =============================================================================
-- Phase 4 adds the inbox spine plus a generic approval queue.
--
-- Design notes:
--
--   * organization_id is denormalized on every child table (inbox_messages,
--     internal_notes) so RLS policies run as plain equality checks instead
--     of subqueries — the policy planner can use the per-table index
--     directly. BEFORE INSERT triggers auto-populate organization_id from
--     the parent thread when callers leave it NULL, so application code
--     stays simple. Same pattern as connected_accounts in 0004.
--
--   * inbox_messages.search_tsv is a STORED generated column over
--     to_tsvector('simple', body). Plain "simple" config — no language
--     stemming — gives accent-tolerant matching when the GIN index meets
--     a normalized query. Trigram support (pg_trgm) for fuzzy fallback
--     is TODO once the dev pglite bundles the extension; tracked in
--     TODO.md.
--
--   * approvals.entity_table is a polymorphic pointer constrained by a
--     CHECK to a small allow-list. Adding a new approvable entity is a
--     migration, not a runtime concern.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE inbox_thread_kind AS ENUM ('dm', 'comment', 'mention', 'review', 'whatsapp');
CREATE TYPE inbox_thread_status AS ENUM ('open', 'pending', 'closed', 'snoozed', 'spam');
CREATE TYPE inbox_thread_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE inbox_sentiment AS ENUM ('positive', 'neutral', 'negative', 'unknown');
CREATE TYPE inbox_message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE inbox_message_author_type AS ENUM ('contact', 'user', 'ai', 'system');
CREATE TYPE approval_kind AS ENUM ('inbox_reply', 'review_response', 'post', 'crisis_response', 'campaign');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'edited_approved', 'rejected', 'expired', 'escalated');
CREATE TYPE approval_risk_level AS ENUM ('low', 'medium', 'high', 'critical');

-- ---------------------------------------------------------------------------
-- contact_profiles
-- ---------------------------------------------------------------------------

CREATE TABLE contact_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform        text NOT NULL,
  external_id     text NOT NULL,
  display_name    text,
  avatar_url      text,
  handle          text,
  language        text,
  tags            jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX contact_profiles_org_platform_external_unique
  ON contact_profiles (organization_id, platform, external_id);
CREATE INDEX contact_profiles_org_handle_idx
  ON contact_profiles (organization_id, handle);

-- ---------------------------------------------------------------------------
-- inbox_threads
-- ---------------------------------------------------------------------------

CREATE TABLE inbox_threads (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id               uuid REFERENCES brands(id) ON DELETE SET NULL,
  location_id            uuid REFERENCES locations(id) ON DELETE SET NULL,
  connected_account_id   uuid REFERENCES connected_accounts(id) ON DELETE SET NULL,
  contact_profile_id     uuid REFERENCES contact_profiles(id) ON DELETE SET NULL,
  platform               text NOT NULL,
  external_thread_id     text,
  kind                   inbox_thread_kind NOT NULL,
  status                 inbox_thread_status NOT NULL DEFAULT 'open',
  priority               inbox_thread_priority NOT NULL DEFAULT 'normal',
  sentiment              inbox_sentiment NOT NULL DEFAULT 'unknown',
  assigned_to            uuid REFERENCES users(id) ON DELETE SET NULL,
  subject                text,
  last_message_at        timestamptz NOT NULL DEFAULT now(),
  -- TODO(blacknel-phase-9): SLA breach computed from priority + brand policy.
  sla_breach_at          timestamptz,
  closed_at              timestamptz,
  tags                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inbox_threads_org_status_idx
  ON inbox_threads (organization_id, status);
CREATE INDEX inbox_threads_org_last_message_idx
  ON inbox_threads (organization_id, last_message_at DESC);
CREATE INDEX inbox_threads_org_assigned_idx
  ON inbox_threads (organization_id, assigned_to);
CREATE INDEX inbox_threads_org_priority_idx
  ON inbox_threads (organization_id, priority);
CREATE INDEX inbox_threads_tags_gin
  ON inbox_threads USING GIN (tags);
CREATE UNIQUE INDEX inbox_threads_org_platform_external_unique
  ON inbox_threads (organization_id, platform, external_thread_id)
  WHERE external_thread_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- inbox_messages — organization_id denormalized via BEFORE INSERT trigger
-- ---------------------------------------------------------------------------

CREATE TABLE inbox_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id            uuid NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
  direction            inbox_message_direction NOT NULL,
  author_type          inbox_message_author_type NOT NULL,
  author_id            uuid,
  body                 text NOT NULL DEFAULT '',
  media                jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_at              timestamptz NOT NULL DEFAULT now(),
  external_message_id  text,
  idempotency_key      text,
  -- Generated FTS column. The 'simple' config gives accent-tolerant
  -- behavior without depending on a language dictionary that pglite may
  -- not bundle. Fuzzy / trigram search (pg_trgm) is TODO — see TODO.md.
  search_tsv           tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inbox_messages_thread_sent_idx
  ON inbox_messages (thread_id, sent_at DESC);
CREATE INDEX inbox_messages_org_sent_idx
  ON inbox_messages (organization_id, sent_at DESC);
CREATE INDEX inbox_messages_search_idx
  ON inbox_messages USING GIN (search_tsv);
CREATE UNIQUE INDEX inbox_messages_thread_idempotency_unique
  ON inbox_messages (thread_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Auto-set organization_id from the parent thread. SECURITY INVOKER (default)
-- so the SELECT against inbox_threads honors the caller's RLS — a cross-tenant
-- thread_id resolves to no row, organization_id stays NULL, and the NOT NULL
-- constraint rejects the insert. Defense in depth alongside RLS WITH CHECK.
CREATE OR REPLACE FUNCTION public.inbox_messages_set_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM inbox_threads WHERE id = NEW.thread_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inbox_messages_set_org
  BEFORE INSERT ON inbox_messages
  FOR EACH ROW EXECUTE FUNCTION public.inbox_messages_set_org_id();

-- ---------------------------------------------------------------------------
-- internal_notes — organization_id denormalized via BEFORE INSERT trigger
-- ---------------------------------------------------------------------------

CREATE TABLE internal_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id       uuid NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
  author_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  pinned          boolean NOT NULL DEFAULT false,
  mentions        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX internal_notes_thread_idx
  ON internal_notes (thread_id);
CREATE INDEX internal_notes_org_pinned_idx
  ON internal_notes (organization_id, pinned)
  WHERE pinned = true;

CREATE OR REPLACE FUNCTION public.internal_notes_set_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM inbox_threads WHERE id = NEW.thread_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_internal_notes_set_org
  BEFORE INSERT ON internal_notes
  FOR EACH ROW EXECUTE FUNCTION public.internal_notes_set_org_id();

-- ---------------------------------------------------------------------------
-- saved_replies
-- ---------------------------------------------------------------------------

CREATE TABLE saved_replies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id           uuid REFERENCES brands(id) ON DELETE CASCADE,
  name               text NOT NULL,
  category           text,
  language           text NOT NULL DEFAULT 'es',
  body               text NOT NULL,
  variables          jsonb NOT NULL DEFAULT '[]'::jsonb,
  platforms_allowed  jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_approval  boolean NOT NULL DEFAULT false,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_replies_org_idx
  ON saved_replies (organization_id);
CREATE INDEX saved_replies_org_category_idx
  ON saved_replies (organization_id, category);

-- ---------------------------------------------------------------------------
-- approvals — polymorphic queue with CHECK-constrained entity_table
-- ---------------------------------------------------------------------------

CREATE TABLE approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind              approval_kind NOT NULL,
  entity_table      text NOT NULL,
  entity_id         uuid NOT NULL,
  requested_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_to       uuid REFERENCES users(id) ON DELETE SET NULL,
  status            approval_status NOT NULL DEFAULT 'pending',
  risk_level        approval_risk_level NOT NULL DEFAULT 'low',
  ai_risk_flags     jsonb NOT NULL DEFAULT '[]'::jsonb,
  original_payload  jsonb,
  proposed_payload  jsonb NOT NULL,
  decision_reason   text,
  decided_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approvals_entity_table_check
    CHECK (entity_table IN ('inbox_messages', 'posts', 'review_responses'))
);

CREATE INDEX approvals_org_status_idx
  ON approvals (organization_id, status);
CREATE INDEX approvals_org_kind_idx
  ON approvals (organization_id, kind);
CREATE INDEX approvals_assigned_idx
  ON approvals (assigned_to);

-- ---------------------------------------------------------------------------
-- updated_at triggers (touch_updated_at defined in 0003)
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_contact_profiles_touch_updated_at
  BEFORE UPDATE ON contact_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_inbox_threads_touch_updated_at
  BEFORE UPDATE ON inbox_threads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_inbox_messages_touch_updated_at
  BEFORE UPDATE ON inbox_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_internal_notes_touch_updated_at
  BEFORE UPDATE ON internal_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_saved_replies_touch_updated_at
  BEFORE UPDATE ON saved_replies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_approvals_touch_updated_at
  BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — every table carries organization_id directly, so policies are
-- single-column equality checks. No subqueries.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON contact_profiles TO authenticated;
ALTER TABLE contact_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_profiles_tenant ON contact_profiles
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON inbox_threads TO authenticated;
ALTER TABLE inbox_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbox_threads_tenant ON inbox_threads
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON inbox_messages TO authenticated;
ALTER TABLE inbox_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbox_messages_tenant ON inbox_messages
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON internal_notes TO authenticated;
ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY internal_notes_tenant ON internal_notes
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON saved_replies TO authenticated;
ALTER TABLE saved_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_replies_tenant ON saved_replies
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON approvals TO authenticated;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY approvals_tenant ON approvals
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
