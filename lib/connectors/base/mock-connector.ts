import { BaseConnector, type FetchOptions, type FetchPage } from './connector';
import { PlatformError, RateLimitedError, TokenExpiredError } from './errors';
import type {
  NormalizedAuthor,
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
 * Shared mock implementation reused by all 16 platform packages.
 *
 * Behavior:
 *
 *   - Deterministic per-account via a seeded RNG keyed on
 *     `(platform, accountId)`. The same account always sees the same
 *     mock items — important so the integration tests can lock-in
 *     snapshots and so the dashboard checklist reads consistently.
 *
 *   - Error simulation gated by `BLACKNEL_MOCK_ERRORS`. When on, ~10%
 *     of calls throw `TokenExpiredError`, ~2% throw `RateLimitedError`.
 *     The throwing call sites are deterministic given the seed too —
 *     same account, same call number, same outcome — so tests can
 *     pin failures.
 *
 *   - All capability gates run via `ensureCapability` from the base
 *     class. Calling a method whose capability isn't in
 *     `declaredCapabilities.supported` throws `CapabilityNotSupportedError`.
 *
 * The Phase 11 cutover replaces this class with per-platform real API
 * clients. The normalized return types and the capability contracts
 * are the only stable surface — they don't change.
 */

const TOKEN_EXPIRED_RATE = 0.1;
const RATE_LIMITED_RATE = 0.02;

export class MockConnector extends BaseConnector {
  readonly platform: PlatformCode;
  protected readonly declaredCapabilities: ConnectorCapabilities;
  private readonly emitErrors: boolean;

  constructor(
    platform: PlatformCode,
    capabilities: ConnectorCapabilities,
    options: { emitErrors?: boolean } = {},
  ) {
    super();
    this.platform = platform;
    this.declaredCapabilities = capabilities;
    this.emitErrors = options.emitErrors ?? false;
  }

  // ------- public API ------------------------------------------------

  override async sync(account: ConnectorAccount): Promise<{ itemsSynced: number }> {
    this.maybeThrow(account, 'sync');
    // The "items" the mock claims it synced is just a deterministic
    // count derived from the seed — Phases 4+ will replace this with
    // real persistence into inbox / reviews tables.
    const rng = makeRng(`${this.platform}:${account.id}:sync`);
    const itemsSynced = Math.floor(rng() * 25);
    return { itemsSynced };
  }

  async fetchComments(
    account: ConnectorAccount,
    opts: FetchOptions = {},
  ): Promise<FetchPage<NormalizedComment>> {
    this.ensureCapability('read_comments');
    this.maybeThrow(account, 'fetchComments');
    const limit = opts.limit ?? 10;
    const rng = makeRng(`${this.platform}:${account.id}:comments`);
    const items: NormalizedComment[] = Array.from({ length: limit }, (_, idx) =>
      makeComment(this.platform, account, rng, idx),
    );
    return { items };
  }

  async replyComment(
    account: ConnectorAccount,
    commentId: string,
    body: string,
  ): Promise<{ externalId: string }> {
    this.ensureCapability('reply_comments');
    this.maybeThrow(account, 'replyComment');
    void body;
    return { externalId: `mock-reply-${commentId}-${randomId()}` };
  }

  async deleteComment(
    account: ConnectorAccount,
    commentId: string,
  ): Promise<void> {
    this.ensureCapability('delete_comment');
    this.maybeThrow(account, 'deleteComment');
    void commentId;
  }

  async fetchMentions(
    account: ConnectorAccount,
    opts: FetchOptions = {},
  ): Promise<FetchPage<NormalizedMention>> {
    this.ensureCapability('read_mentions');
    this.maybeThrow(account, 'fetchMentions');
    const limit = opts.limit ?? 10;
    const rng = makeRng(`${this.platform}:${account.id}:mentions`);
    const items: NormalizedMention[] = Array.from({ length: limit }, (_, idx) => ({
      platform: this.platform,
      externalId: `mock-mention-${idx}-${Math.floor(rng() * 1e9)}`,
      author: makeAuthor(this.platform, rng),
      body: pickPhrase(rng),
      postedAt: relativeDate(rng, 30),
      url: `https://example.${this.platform}/mention/${idx}`,
      reach: Math.floor(rng() * 50_000),
      sentiment: rng() * 2 - 1,
    }));
    return { items };
  }

  async fetchThreads(
    account: ConnectorAccount,
    opts: FetchOptions = {},
  ): Promise<FetchPage<NormalizedThread>> {
    this.ensureCapability('read_dms');
    this.maybeThrow(account, 'fetchThreads');
    const limit = opts.limit ?? 10;
    const rng = makeRng(`${this.platform}:${account.id}:threads`);
    const items: NormalizedThread[] = Array.from({ length: limit }, (_, idx) => ({
      platform: this.platform,
      externalId: `mock-thread-${idx}-${Math.floor(rng() * 1e9)}`,
      kind: 'dm',
      contact: makeAuthor(this.platform, rng),
      lastMessageAt: relativeDate(rng, 7),
      unread: rng() > 0.5,
      preview: pickPhrase(rng),
    }));
    return { items };
  }

  async fetchMessages(
    account: ConnectorAccount,
    threadId: string,
    opts: FetchOptions = {},
  ): Promise<FetchPage<NormalizedMessage>> {
    this.ensureCapability('read_dms');
    this.maybeThrow(account, 'fetchMessages');
    const limit = opts.limit ?? 10;
    const rng = makeRng(`${this.platform}:${account.id}:msgs:${threadId}`);
    const items: NormalizedMessage[] = Array.from({ length: limit }, (_, idx) => ({
      platform: this.platform,
      externalId: `mock-msg-${idx}-${Math.floor(rng() * 1e9)}`,
      direction: rng() > 0.5 ? 'inbound' : 'outbound',
      author: makeAuthor(this.platform, rng),
      body: pickPhrase(rng),
      postedAt: relativeDate(rng, 7),
    }));
    return { items };
  }

  async sendMessage(
    account: ConnectorAccount,
    threadId: string,
    body: string,
  ): Promise<{ externalId: string }> {
    this.ensureCapability('send_dms');
    this.maybeThrow(account, 'sendMessage');
    void threadId;
    void body;
    return { externalId: `mock-dm-${randomId()}` };
  }

  async publishPost(
    account: ConnectorAccount,
    draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
  ): Promise<{ externalId: string }> {
    this.ensureCapability('publish_post');
    this.maybeThrow(account, 'publishPost');
    void draft;
    return { externalId: `mock-post-${randomId()}` };
  }

  async schedulePost(
    account: ConnectorAccount,
    draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
    when: Date,
  ): Promise<{ externalId: string }> {
    this.ensureCapability('schedule_post');
    this.maybeThrow(account, 'schedulePost');
    void draft;
    void when;
    return { externalId: `mock-scheduled-${randomId()}` };
  }

  async deletePost(account: ConnectorAccount, postId: string): Promise<void> {
    this.ensureCapability('delete_post');
    this.maybeThrow(account, 'deletePost');
    void postId;
  }

  async fetchPosts(
    account: ConnectorAccount,
    opts: FetchOptions = {},
  ): Promise<FetchPage<NormalizedPost>> {
    this.ensureCapability('publish_post');
    this.maybeThrow(account, 'fetchPosts');
    const limit = opts.limit ?? 10;
    const rng = makeRng(`${this.platform}:${account.id}:posts`);
    const items: NormalizedPost[] = Array.from({ length: limit }, (_, idx) => ({
      platform: this.platform,
      externalId: `mock-pubpost-${idx}-${Math.floor(rng() * 1e9)}`,
      body: pickPhrase(rng),
      publishedAt: relativeDate(rng, 30),
      scheduledAt: null,
    }));
    return { items };
  }

  async fetchReviews(
    account: ConnectorAccount,
    opts: FetchOptions = {},
  ): Promise<FetchPage<NormalizedReview>> {
    this.ensureCapability('read_reviews');
    this.maybeThrow(account, 'fetchReviews');
    const limit = opts.limit ?? 10;
    const rng = makeRng(`${this.platform}:${account.id}:reviews`);
    const items: NormalizedReview[] = Array.from({ length: limit }, (_, idx) => ({
      platform: this.platform,
      externalId: `mock-review-${idx}-${Math.floor(rng() * 1e9)}`,
      author: makeAuthor(this.platform, rng),
      rating: Math.max(1, Math.min(5, Math.floor(rng() * 5) + 1)),
      body: pickPhrase(rng),
      postedAt: relativeDate(rng, 60),
      permalink: `https://example.${this.platform}/review/${idx}`,
    }));
    return { items };
  }

  async replyReview(
    account: ConnectorAccount,
    reviewId: string,
    body: string,
  ): Promise<{ externalId: string }> {
    this.ensureCapability('reply_reviews');
    this.maybeThrow(account, 'replyReview');
    void reviewId;
    void body;
    return { externalId: `mock-review-reply-${randomId()}` };
  }

  async sendReviewRequest(
    account: ConnectorAccount,
    contact: { email?: string; phone?: string },
  ): Promise<{ externalId: string }> {
    this.ensureCapability('send_review_request');
    this.maybeThrow(account, 'sendReviewRequest');
    void contact;
    return { externalId: `mock-review-request-${randomId()}` };
  }

  async fetchInsights(
    account: ConnectorAccount,
    range: { start: Date; end: Date },
  ): Promise<NormalizedInsights> {
    this.ensureCapability('read_insights');
    this.maybeThrow(account, 'fetchInsights');
    const rng = makeRng(`${this.platform}:${account.id}:insights:${range.start.toISOString()}`);
    return {
      platform: this.platform,
      rangeStart: range.start,
      rangeEnd: range.end,
      metrics: {
        reach: Math.floor(rng() * 50_000),
        impressions: Math.floor(rng() * 200_000),
        engagement: Math.floor(rng() * 5_000),
        followers: Math.floor(rng() * 10_000),
      },
    };
  }

  // ------- internals --------------------------------------------------

  private maybeThrow(account: ConnectorAccount, method: string): void {
    if (!this.emitErrors) return;
    const r = deterministicChance(`${this.platform}:${account.id}:${method}:err`);
    if (r < TOKEN_EXPIRED_RATE) throw new TokenExpiredError(this.platform);
    if (r < TOKEN_EXPIRED_RATE + RATE_LIMITED_RATE) {
      throw new RateLimitedError(this.platform, 30_000);
    }
    // Surface platform errors on a small percentage so the UI surfaces
    // the generic-error path too.
    if (r > 0.98) throw new PlatformError(this.platform, 'transient platform 5xx');
  }
}

/** Strip a capability set against the supported list — for narrowing. */
export function declareCapabilities(supported: ReadonlyArray<Capability>, notes?: Partial<Record<Capability, string>>): ConnectorCapabilities {
  return notes ? { supported, notes } : { supported };
}

// --------- deterministic mock primitives -------------------------------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32, seeded by a string — deterministic, fast, good enough. */
function makeRng(seed: string): () => number {
  let state = hashString(seed);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicChance(seed: string): number {
  return makeRng(seed)();
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeAuthor(platform: PlatformCode, rng: () => number): NormalizedAuthor {
  const num = Math.floor(rng() * 9999);
  return {
    platform,
    externalId: `${platform}-user-${num}`,
    displayName: pickName(rng),
    handle: `@user${num}`,
  };
}

function relativeDate(rng: () => number, withinDays: number): Date {
  const offset = Math.floor(rng() * withinDays * 24 * 60 * 60 * 1000);
  return new Date(Date.now() - offset);
}

const PHRASES: ReadonlyArray<string> = [
  'Excelente atención, volveré pronto.',
  '¿Tienen disponibilidad este fin de semana?',
  'No me gustó la espera, deberían mejorar.',
  'La comida estuvo riquísima 🍝',
  'Compré por su anuncio, lo recomiendo.',
  '¿A qué hora abren mañana?',
  'Servicio muy profesional, gracias.',
  'Tuve un problema con mi pedido, ¿pueden ayudarme?',
  'Muy buena experiencia, los volveré a visitar.',
  'Las instalaciones están impecables.',
];

const NAMES: ReadonlyArray<string> = [
  'Ana Pérez',
  'Luis Hernández',
  'María González',
  'Carlos Ramírez',
  'Sofía Martín',
  'Diego López',
  'Lucía Castro',
  'Mateo Reyes',
  'Camila Vega',
  'Andrés Vargas',
];

function pickPhrase(rng: () => number): string {
  const i = Math.floor(rng() * PHRASES.length);
  return PHRASES[i]!;
}

function pickName(rng: () => number): string {
  const i = Math.floor(rng() * NAMES.length);
  return NAMES[i]!;
}

function makeComment(
  platform: PlatformCode,
  account: ConnectorAccount,
  rng: () => number,
  idx: number,
): NormalizedComment {
  return {
    platform,
    externalId: `mock-${account.id}-${idx}-${Math.floor(rng() * 1e9)}`,
    externalParentId: null,
    author: makeAuthor(platform, rng),
    body: pickPhrase(rng),
    postedAt: relativeDate(rng, 14),
    permalink: `https://example.${platform}/post/${idx}`,
  };
}
