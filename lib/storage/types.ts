/**
 * Storage abstraction for the publish asset library and any future
 * blob-storage caller (Phase 7 AI artifacts, Phase 8 report PDFs).
 *
 * Implementations:
 *
 *   - `DevFilesystemProvider` (Commit 19b) — persists to
 *     `.blacknel/dev-uploads/<orgId>/<assetId>.<ext>`. Served by
 *     `/api/dev-uploads/[orgId]/[filename]` with org-aware auth.
 *
 *   - `SupabaseStorageProvider` (Phase 11) — drop-in replacement
 *     wrapping the Supabase Storage API. The `factory` in
 *     `./index.ts` chooses one at runtime based on
 *     `BLACKNEL_USE_MOCKS`. UI code never references either
 *     concrete type — only this interface.
 *
 * # Keys
 *
 * A `key` is the opaque storage handle, e.g.
 * `aaaa-...-bbbb/cccc-...-dddd.png`. Callers should treat it as
 * write-once: the provider chooses the layout and may change it
 * across implementations as long as `getUrl` / `delete` /
 * `exists` remain valid for keys returned from `upload`.
 */

export type AssetKind = 'image' | 'video' | 'pdf' | 'gif';

export interface UploadOpts {
  readonly orgId: string;
  readonly assetId: string;
  /**
   * Original filename — used only for extension derivation. The
   * stored object lives under `<orgId>/<assetId>.<ext>`; the
   * original name is preserved in `content_assets.name` instead.
   */
  readonly originalFilename: string;
  /**
   * MIME content-type. Provider may persist alongside the file or
   * derive it at read time; the route handler that serves the
   * blob reads from `content_assets.metadata.contentType` so the
   * provider isn't on the hot path here.
   */
  readonly contentType: string;
  readonly kind: AssetKind;
}

export interface StoredAsset {
  /** Opaque key the provider returns and accepts back. */
  readonly key: string;
  /** Bytes written to durable storage. */
  readonly bytes: number;
  /** Content-Type the provider observed / persisted. */
  readonly contentType: string;
}

export interface StorageProvider {
  /**
   * Persists `file` and returns a `StoredAsset` with the key the
   * caller should record in `content_assets.storage_key`. Throws
   * on filesystem / IO failure; client validation should have
   * already enforced size / type — the provider does not.
   */
  upload(file: Buffer, opts: UploadOpts): Promise<StoredAsset>;

  /**
   * Returns the URL the client should embed to fetch the asset.
   *
   *   - DevFilesystemProvider → `/api/dev-uploads/<key>`
   *   - SupabaseStorageProvider → signed CDN URL
   *
   * The dev variant is intentionally unsigned: the route handler
   * authorizes per-request against the session, so we don't need
   * a signed-URL TTL. Phase 11 swaps to signed URLs.
   */
  getUrl(key: string): string;

  /** Removes the persisted object. Idempotent — missing keys resolve `void`. */
  delete(key: string): Promise<void>;

  /** True when the key still has a backing object. */
  exists(key: string): Promise<boolean>;
}

/**
 * Sanity caps. The provider enforces these even when the caller
 * also did (defense in depth at the IO boundary). Numbers are
 * deliberately above the highest plan tier so the provider never
 * becomes the binding constraint; per-plan caps live in
 * `PlanLimits` and are enforced before the provider is invoked.
 */
export const STORAGE_HARD_CAP_BYTES = 250_000_000; // 250 MB

/** Extensions the dev provider accepts. Phase 11 may broaden this. */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp4',
  '.mov',
  '.webm',
  '.pdf',
]);
