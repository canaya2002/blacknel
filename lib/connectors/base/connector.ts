import { CapabilityNotSupportedError } from './errors';
import type {
  NormalizedComment,
  NormalizedInsights,
  NormalizedMention,
  NormalizedMessage,
  NormalizedPost,
  NormalizedReview,
  NormalizedThread,
} from './normalized';
import type { Capability, ConnectorAccount, ConnectorCapabilities, PlatformCode } from './types';

/**
 * Common fetch / paging options. Connectors that don't need pagination
 * just ignore the cursor field.
 */
export interface FetchOptions {
  cursor?: string;
  limit?: number;
  sinceMs?: number;
}

export interface FetchPage<T> {
  items: ReadonlyArray<T>;
  nextCursor?: string;
}

/**
 * The full optional connector surface. Each method is `?` because no
 * platform supports everything — `capabilities(account).supported`
 * is the source of truth for what's enabled. Calling an unsupported
 * method must throw `CapabilityNotSupportedError`.
 */
export interface Connector {
  readonly platform: PlatformCode;

  capabilities(account: ConnectorAccount): ConnectorCapabilities;

  // Comments / mentions
  fetchComments?(
    account: ConnectorAccount,
    opts?: FetchOptions,
  ): Promise<FetchPage<NormalizedComment>>;
  replyComment?(
    account: ConnectorAccount,
    commentId: string,
    body: string,
  ): Promise<{ externalId: string }>;
  deleteComment?(
    account: ConnectorAccount,
    commentId: string,
  ): Promise<void>;
  fetchMentions?(
    account: ConnectorAccount,
    opts?: FetchOptions,
  ): Promise<FetchPage<NormalizedMention>>;

  // DMs / threads
  fetchThreads?(
    account: ConnectorAccount,
    opts?: FetchOptions,
  ): Promise<FetchPage<NormalizedThread>>;
  fetchMessages?(
    account: ConnectorAccount,
    threadId: string,
    opts?: FetchOptions,
  ): Promise<FetchPage<NormalizedMessage>>;
  sendMessage?(
    account: ConnectorAccount,
    threadId: string,
    body: string,
  ): Promise<{ externalId: string }>;

  // Publishing
  publishPost?(
    account: ConnectorAccount,
    draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
    options?: { idempotencyKey?: string },
  ): Promise<{ externalId: string }>;
  schedulePost?(
    account: ConnectorAccount,
    draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
    when: Date,
    options?: { idempotencyKey?: string },
  ): Promise<{ externalId: string }>;
  deletePost?(
    account: ConnectorAccount,
    postId: string,
  ): Promise<void>;

  // Reviews
  fetchReviews?(
    account: ConnectorAccount,
    opts?: FetchOptions,
  ): Promise<FetchPage<NormalizedReview>>;
  replyReview?(
    account: ConnectorAccount,
    reviewId: string,
    body: string,
  ): Promise<{ externalId: string }>;
  sendReviewRequest?(
    account: ConnectorAccount,
    contact: { email?: string; phone?: string },
  ): Promise<{ externalId: string }>;

  // Insights / ads
  fetchInsights?(
    account: ConnectorAccount,
    range: { start: Date; end: Date },
  ): Promise<NormalizedInsights>;
  fetchPosts?(
    account: ConnectorAccount,
    opts?: FetchOptions,
  ): Promise<FetchPage<NormalizedPost>>;

  /** Sync entry point. Triggers a full pass across the account's enabled capabilities. */
  sync(account: ConnectorAccount): Promise<{ itemsSynced: number }>;
}

/**
 * Concrete base most platforms extend. Stores the declared capability
 * set and provides `ensureCapability` so subclass methods can guard
 * themselves with one line.
 */
export abstract class BaseConnector implements Connector {
  abstract readonly platform: PlatformCode;
  protected abstract readonly declaredCapabilities: ConnectorCapabilities;

  capabilities(_account: ConnectorAccount): ConnectorCapabilities {
    return this.declaredCapabilities;
  }

  /**
   * Throws `CapabilityNotSupportedError` if `cap` isn't declared.
   * Server Actions and job dispatchers call this before doing real work
   * so platform contracts are enforced uniformly.
   */
  protected ensureCapability(cap: Capability): void {
    if (!this.declaredCapabilities.supported.includes(cap)) {
      throw new CapabilityNotSupportedError(this.platform, cap);
    }
  }

  abstract sync(account: ConnectorAccount): Promise<{ itemsSynced: number }>;
}
