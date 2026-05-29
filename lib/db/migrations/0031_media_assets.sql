-- =============================================================================
-- 0031_media_assets.sql — Phase 11 / C44. WRITE ONLY (Carlos applies).
--
-- R2-backed user media (presigned-PUT flow). Tenant-scoped via RLS, like the
-- rest of the schema. Distinct from content_assets (the composer library).
-- =============================================================================

CREATE TABLE media_assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Tenant-namespaced R2 key: orgs/{orgId}/media/{uuid}.{ext}.
  key               text NOT NULL,
  bucket            text NOT NULL,
  content_type      text NOT NULL,
  size_bytes        bigint NOT NULL DEFAULT 0,
  original_filename text NOT NULL,
  uploaded_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'pending',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_status_check CHECK (status IN ('pending', 'ready', 'deleted'))
);

CREATE UNIQUE INDEX media_assets_org_key_unique ON media_assets (organization_id, key);
CREATE INDEX media_assets_org_status_idx ON media_assets (organization_id, status);
CREATE INDEX media_assets_org_created_idx ON media_assets (organization_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON media_assets TO authenticated;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_assets_tenant ON media_assets
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

COMMENT ON TABLE media_assets IS
  'Phase 11 / C44 — R2-backed user media via presigned uploads. Tenant-scoped
   (RLS on organization_id). Lifecycle pending→ready→deleted; cleanup cron
   reaps stale pending rows + their R2 objects.';
