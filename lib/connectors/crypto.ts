import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/log';

/**
 * AES-256-GCM at-rest encryption for connector OAuth tokens (C46).
 *
 * Tokens are stored encrypted in `connected_accounts.oauth_tokens_encrypted`
 * (jsonb) and decrypted ONLY server-side at the moment a connector calls the
 * platform API. Plaintext tokens never touch the DB, logs, or the client.
 *
 * Envelope (stored as jsonb): { v, alg, iv, ct, tag } — all base64. The 32-byte
 * key is derived from `CONNECTION_ENCRYPTION_KEY` via scrypt with a fixed,
 * versioned salt (so any sufficiently-long operator secret yields a valid key,
 * and the derivation is deterministic across processes). GCM's auth tag makes
 * tampering or a wrong key fail loudly on decrypt rather than returning garbage.
 */

const ALG = 'aes-256-gcm' as const;
const ENVELOPE_VERSION = 1 as const;
const KEY_SALT = 'blacknel/connector-tokens/v1';
const IV_BYTES = 12; // GCM standard nonce length.

export interface EncryptedEnvelope {
  readonly v: number;
  readonly alg: 'aes-256-gcm';
  readonly iv: string;
  readonly ct: string;
  readonly tag: string;
}

let keyOverride: Buffer | null = null;

/** Test seam — inject a deterministic key so tests don't depend on env. */
export function _setEncryptionKeyForTests(raw: string | null): void {
  keyOverride = raw ? deriveKey(raw) : null;
}

function deriveKey(raw: string): Buffer {
  return scryptSync(raw, KEY_SALT, 32);
}

const DEV_FALLBACK_SECRET = 'blacknel-dev-insecure-connection-key-do-not-use-in-prod';
let warnedDevFallback = false;

function resolveKey(): Buffer {
  if (keyOverride) return keyOverride;
  const raw = env.CONNECTION_ENCRYPTION_KEY;
  if (raw) return deriveKey(raw);
  // Production MUST have a real key — fail loudly. Non-prod (dev/preview without
  // the key) gets an insecure fallback so the mock OAuth flow (signState ⇒
  // encrypt) works on a fresh clone without setup. Real tokens are only stored
  // on the gated real path, where prod requires the configured key.
  if (env.NODE_ENV === 'production') {
    throw new AppError(
      'INTERNAL_ERROR',
      'CONNECTION_ENCRYPTION_KEY is not set — cannot encrypt/decrypt connector tokens in production.',
    );
  }
  if (!warnedDevFallback) {
    warnedDevFallback = true;
    log.warn(
      'CONNECTION_ENCRYPTION_KEY not set — using an INSECURE dev fallback key. Set it before enabling real connectors.',
    );
  }
  return deriveKey(DEV_FALLBACK_SECRET);
}

/** Encrypt a UTF-8 string into an AES-256-GCM envelope. */
export function encrypt(plaintext: string): EncryptedEnvelope {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: ENVELOPE_VERSION,
    alg: ALG,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/** Decrypt an envelope back to the UTF-8 plaintext. Throws on tamper/wrong key. */
export function decrypt(envelope: EncryptedEnvelope): string {
  if (!isEncryptedEnvelope(envelope)) {
    throw new AppError('INTERNAL_ERROR', 'Malformed encryption envelope.');
  }
  const key = resolveKey();
  const iv = Buffer.from(envelope.iv, 'base64');
  const ct = Buffer.from(envelope.ct, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (cause) {
    // GCM auth failure (tampered ciphertext or wrong key) — never leak plaintext.
    throw new AppError('INTERNAL_ERROR', 'Failed to decrypt connector token (auth tag mismatch).', {
      cause,
    });
  }
}

/** Encrypt a JSON-serialisable value. */
export function encryptJson(value: unknown): EncryptedEnvelope {
  return encrypt(JSON.stringify(value));
}

/** Decrypt an envelope and JSON-parse the plaintext. */
export function decryptJson<T>(envelope: EncryptedEnvelope): T {
  return JSON.parse(decrypt(envelope)) as T;
}

/** Type guard — distinguishes a real envelope from the empty `{}` default. */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    e.alg === ALG &&
    typeof e.iv === 'string' &&
    typeof e.ct === 'string' &&
    typeof e.tag === 'string'
  );
}
