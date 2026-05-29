import 'server-only';

/**
 * R2 media storage layer (C44). The adapter is a thin object-storage interface
 * (presign / delete / list); the high-level tenant + quota + DB logic lives in
 * `./client.ts`. Real adapter = Cloudflare R2 (S3-compatible); mock adapter =
 * in-memory URL stubs for dev/test.
 */

export interface PresignedPut {
  readonly url: string;
  readonly expiresInSec: number;
}

export interface MediaStorageAdapter {
  presignUpload(
    bucket: string,
    key: string,
    contentType: string,
  ): Promise<PresignedPut>;
  presignDownload(bucket: string, key: string): Promise<string>;
  publicUrl(key: string): string;
  deleteObject(bucket: string, key: string): Promise<void>;
  listKeys(bucket: string, prefix: string): Promise<string[]>;
}

/** Presigned URL lifetime — short-lived. */
export const PRESIGN_TTL_SEC = 600; // 10 min

/** Hard ceiling per object (plan caps are lower; this is the IO-boundary cap). */
export const MAX_MEDIA_BYTES = 250_000_000; // 250 MB

/** Allowed upload content-types (images + video for posts/brand assets). */
export const ALLOWED_MEDIA_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

/** Extension for an allowed content-type (used to build the object key). */
export const EXT_FOR_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};
