import { AppError } from '@/lib/errors';

import type { Capability, PlatformCode } from './types';

/**
 * Typed connector errors. Server Actions catch these and map to the
 * matching UI banner (reconnect prompt, rate-limit toast, etc.).
 * Subclasses keep the `AppError` discriminated code so existing
 * `isAppError(err)` checks still work upstream.
 */

export class ConnectorError extends AppError {
  public readonly platform: PlatformCode;

  constructor(
    platform: PlatformCode,
    message: string,
    options?: { meta?: Record<string, unknown>; cause?: unknown },
  ) {
    super('INTEGRATION_DISCONNECTED', message, options);
    this.name = 'ConnectorError';
    this.platform = platform;
  }
}

/** OAuth refresh failed or session was revoked. UI shows "Reconectar". */
export class TokenExpiredError extends ConnectorError {
  constructor(platform: PlatformCode, options?: { cause?: unknown }) {
    super(platform, `Tokens del conector ${platform} expiraron o fueron revocados.`, options);
    this.name = 'TokenExpiredError';
  }
}

/** Platform-side rate limit. Callers typically retry with backoff. */
export class RateLimitedError extends ConnectorError {
  public readonly retryAfterMs: number;
  constructor(platform: PlatformCode, retryAfterMs: number, options?: { cause?: unknown }) {
    super(platform, `Rate-limit del conector ${platform}; reintentar en ${retryAfterMs}ms.`, {
      meta: { retryAfterMs },
      ...(options?.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The caller asked the connector to do something its `capabilities()`
 * doesn't include. UI usually prevents this by hiding the button, but
 * the connector still defends against bad callers (server-side gate).
 */
export class CapabilityNotSupportedError extends ConnectorError {
  public readonly capability: Capability;
  constructor(platform: PlatformCode, capability: Capability) {
    super(platform, `Capability "${capability}" no está soportada por ${platform}.`, {
      meta: { capability },
    });
    this.name = 'CapabilityNotSupportedError';
    this.capability = capability;
  }
}

/** Catch-all for unexpected platform errors. Wraps the raw cause. */
export class PlatformError extends ConnectorError {
  constructor(platform: PlatformCode, message: string, options?: { cause?: unknown }) {
    super(platform, `Platform error (${platform}): ${message}`, options);
    this.name = 'PlatformError';
  }
}
