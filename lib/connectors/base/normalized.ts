import type { PlatformCode } from './types';

/**
 * Normalized DTOs. The UI consumes these — never platform-specific
 * shapes. Each connector implementation is responsible for translating
 * its native API payload into one of these types.
 *
 * In Phase 11 when real APIs come online, only the translation layer
 * inside each connector changes. The pages that show "a thread" or
 * "a review" never need to know who the platform was.
 */

export interface NormalizedAuthor {
  platform: PlatformCode;
  externalId: string;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
}

export interface NormalizedMedia {
  url: string;
  kind: 'image' | 'video' | 'pdf';
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface NormalizedComment {
  platform: PlatformCode;
  externalId: string;
  externalParentId: string | null;
  author: NormalizedAuthor;
  body: string;
  language?: string;
  postedAt: Date;
  permalink?: string;
}

export interface NormalizedMessage {
  platform: PlatformCode;
  externalId: string;
  direction: 'inbound' | 'outbound';
  author: NormalizedAuthor;
  body: string;
  media?: ReadonlyArray<NormalizedMedia>;
  postedAt: Date;
}

export interface NormalizedThread {
  platform: PlatformCode;
  externalId: string;
  /** DM, comment thread, mention thread, review thread, etc. */
  kind: 'dm' | 'comment' | 'mention' | 'review';
  contact: NormalizedAuthor;
  lastMessageAt: Date;
  unread: boolean;
  preview: string;
}

export interface NormalizedReview {
  platform: PlatformCode;
  externalId: string;
  author: NormalizedAuthor;
  rating: number; // 1..5
  body: string;
  language?: string;
  postedAt: Date;
  permalink?: string;
}

export interface NormalizedPost {
  platform: PlatformCode;
  externalId: string;
  body: string;
  media?: ReadonlyArray<NormalizedMedia>;
  link?: string;
  publishedAt: Date | null;
  scheduledAt: Date | null;
  permalink?: string;
}

export interface NormalizedInsights {
  platform: PlatformCode;
  rangeStart: Date;
  rangeEnd: Date;
  metrics: Record<string, number>;
}

export interface NormalizedMention {
  platform: PlatformCode;
  externalId: string;
  author: NormalizedAuthor;
  body: string;
  postedAt: Date;
  url: string;
  reach?: number;
  /** -1..+1 by convention; connectors may leave unset. */
  sentiment?: number;
}
