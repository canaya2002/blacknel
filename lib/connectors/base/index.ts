/**
 * Barrel re-exports for connector consumers. Server Actions, job
 * dispatchers and the registry pull from `@/lib/connectors/base`.
 */
export type {
  Capability,
  ConnectorAccount,
  ConnectorCapabilities,
  PlatformCode,
  PublishLimits,
} from './types';
export { CAPABILITIES, PLATFORMS } from './types';

export type { Connector, FetchOptions, FetchPage } from './connector';
export { BaseConnector } from './connector';
export { MockConnector, declareCapabilities } from './mock-connector';
export {
  MOCK_IDEMPOTENCY_MAP,
  clearMockIdempotency,
  mockIdempotencyGet,
  mockIdempotencySet,
} from './mock-publish';

export {
  ConnectorError,
  CapabilityNotSupportedError,
  PlatformError,
  RateLimitedError,
  TokenExpiredError,
} from './errors';

export type {
  NormalizedAuthor,
  NormalizedComment,
  NormalizedInsights,
  NormalizedMedia,
  NormalizedMention,
  NormalizedMessage,
  NormalizedPost,
  NormalizedReview,
  NormalizedThread,
} from './normalized';
