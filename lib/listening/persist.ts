import 'server-only';

import { classifyIntent } from '@/lib/ai/skills/intent';
import { classifySentiment } from '@/lib/ai/skills/sentiment';
import type { ListeningMockMention } from '@/lib/connectors/listening/mock';
import { type AnyPgTx } from '@/lib/db/client';
import {
  listeningMentions,
  type NewListeningMention,
} from '@/lib/db/schema';
import { log } from '@/lib/log';

/**
 * Persist a batch of mock-scanned mentions for a tracked term
 * (Phase 9 / Commit 33).
 *
 * Pipeline per mention:
 *
 *   1. Call AI sentiment skill (`lib/ai/skills/sentiment`) on the
 *      body. Falls back to the mock's `hintSentiment` if the skill
 *      errors — the system surface should not fail on AI flakiness.
 *
 *   2. Call AI intent skill (`lib/ai/skills/intent`) to derive
 *      `is_lead`. The skill returns one of seven intent labels;
 *      we map `sales_inquiry` and `info_request` to `is_lead=true`.
 *      Mock fallback: if the skill errors, treat 0% as lead.
 *
 *   3. Insert the row through the caller-supplied transaction.
 *      `listening_mentions_external_unique` makes re-runs of the
 *      same `(org, platform, external_id)` a no-op.
 *
 * R-33-1 invariant: this function is the *only* path that invokes
 * AI skills against listening data. The SEED never reaches here —
 * `seed-listening.ts` builds rows with pre-classified sentiment +
 * is_lead directly. The cron tick is the runtime entry point.
 */

export interface PersistMentionInput {
  readonly organizationId: string;
  readonly trackedTermId: string;
  readonly brandId: string | null;
  readonly mention: ListeningMockMention;
}

export interface PersistMentionResult {
  readonly mentionId: string | null;
  readonly skipped: boolean;
}

const LEAD_INTENTS = new Set(['sales_inquiry', 'info_request']);

export async function persistMention(
  tx: AnyPgTx,
  input: PersistMentionInput,
): Promise<PersistMentionResult> {
  const { organizationId, trackedTermId, brandId, mention } = input;

  // Sentiment via AI. Fall back to the mock hint when the skill
  // fails — the system shouldn't lose a mention because the AI
  // backend stuttered.
  let sentiment: 'positive' | 'neutral' | 'negative' = mention.hintSentiment;
  let sentimentScore = 0.5;
  try {
    const out = await classifySentiment({
      text: mention.body,
      context: {
        orgId: organizationId,
        userId: null,
        actorType: 'system',
        entityType: 'org',
        entityId: null,
        ...(brandId ? { brandId } : {}),
      },
    });
    sentiment = out.sentiment;
    sentimentScore = out.confidence;
  } catch (cause) {
    log.warn(
      {
        err: (cause as Error).message,
        organizationId,
        trackedTermId,
        externalId: mention.externalId,
      },
      'listening.sentiment.skill.fallback',
    );
  }

  // Intent → is_lead.
  let isLead = false;
  try {
    const out = await classifyIntent({
      text: mention.body,
      context: {
        orgId: organizationId,
        userId: null,
        actorType: 'system',
        entityType: 'org',
        entityId: null,
        ...(brandId ? { brandId } : {}),
      },
    });
    isLead = LEAD_INTENTS.has(out.primaryIntent);
  } catch (cause) {
    log.warn(
      {
        err: (cause as Error).message,
        organizationId,
        trackedTermId,
        externalId: mention.externalId,
      },
      'listening.intent.skill.fallback',
    );
  }

  const values: NewListeningMention = {
    organizationId,
    trackedTermId,
    brandId,
    platform: mention.platform,
    externalId: mention.externalId,
    authorHandle: mention.authorHandle,
    authorDisplayName: mention.authorDisplayName,
    body: mention.body,
    url: mention.url,
    kind: mention.kind,
    sentiment:
      sentiment === 'positive'
        ? 'positive'
        : sentiment === 'negative'
          ? 'negative'
          : 'neutral',
    sentimentScore: sentimentScore.toFixed(2),
    isLead,
    capturedAt: mention.capturedAt,
  };

  const inserted = await tx
    .insert(listeningMentions)
    .values(values)
    .onConflictDoNothing({
      target: [
        listeningMentions.organizationId,
        listeningMentions.platform,
        listeningMentions.externalId,
      ],
    })
    .returning({ id: listeningMentions.id });

  if (inserted.length === 0) {
    return { mentionId: null, skipped: true };
  }
  return { mentionId: inserted[0]!.id, skipped: false };
}
