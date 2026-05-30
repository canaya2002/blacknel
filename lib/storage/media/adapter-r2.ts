import 'server-only';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/lib/env';

import { PRESIGN_TTL_SEC, type MediaStorageAdapter } from './types';

/**
 * Real Cloudflare R2 adapter (S3-compatible). Endpoint is the account-scoped
 * R2 host; region is the fixed `auto`. Secrets come from env and NEVER reach
 * the client — only short-lived presigned URLs do.
 */

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID ?? ''}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
      },
    });
  }
  return _client;
}

/** Test seam. */
export function _resetR2ClientForTests(): void {
  _client = null;
}

export const r2Adapter: MediaStorageAdapter = {
  async presignUpload(bucket, key, contentType) {
    const url = await getSignedUrl(
      getClient(),
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: PRESIGN_TTL_SEC },
    );
    return { url, expiresInSec: PRESIGN_TTL_SEC };
  },

  async presignDownload(bucket, key) {
    return getSignedUrl(
      getClient(),
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: PRESIGN_TTL_SEC },
    );
  },

  publicUrl(key) {
    const base = (env.R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
    return `${base}/${key}`;
  },

  async deleteObject(bucket, key) {
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },

  async listKeys(bucket, prefix) {
    const out = await getClient().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
    );
    return (out.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => typeof k === 'string');
  },

  async putObject(bucket, key, body, contentType) {
    await getClient().send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    );
  },
};
