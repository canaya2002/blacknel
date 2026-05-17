import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { type AnyPgTx, dbAs } from '../db/client';
import { brandVoices, brands } from '../db/schema';

import type { ApprovalRules } from './validate';

/**
 * Read paths for /settings/brand-voice (Commit 26).
 *
 *   - `listBrandsWithVoice` — every brand in the org with the
 *     paired voice metadata (when a voice is assigned). Drives
 *     the index page list.
 *
 *   - `getBrandVoiceDetail` — full row + computed `approvalRules`
 *     extraction for the editor page.
 */

export interface BrandWithVoiceItem {
  readonly brandId: string;
  readonly brandName: string;
  readonly brandSlug: string;
  readonly brandVoiceId: string | null;
  readonly voiceName: string | null;
  readonly tone: string | null;
  readonly languages: ReadonlyArray<string>;
  readonly approvalRulesActive: boolean;
}

export async function listBrandsWithVoice(opts: {
  orgId: string;
  userId: string;
}): Promise<ReadonlyArray<BrandWithVoiceItem>> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    listBrandsWithVoiceWithTx(tx, opts.orgId),
  );
}

export async function listBrandsWithVoiceWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<ReadonlyArray<BrandWithVoiceItem>> {
  type Row = {
    brandId: string;
    brandName: string;
    brandSlug: string;
    brandVoiceId: string | null;
    voiceName: string | null;
    tone: string | null;
    languages: unknown;
    metadata: unknown;
  };
  const rows = (await tx
    .select({
      brandId: brands.id,
      brandName: brands.name,
      brandSlug: brands.slug,
      brandVoiceId: brands.brandVoiceId,
      voiceName: brandVoices.name,
      tone: brandVoices.tone,
      languages: brandVoices.languages,
      metadata: brandVoices.metadata,
    })
    .from(brands)
    .leftJoin(brandVoices, eq(brandVoices.id, brands.brandVoiceId))
    .where(eq(brands.organizationId, orgId))
    .orderBy(asc(brands.name))) as Row[];

  return rows.map((r): BrandWithVoiceItem => {
    const langs = Array.isArray(r.languages)
      ? (r.languages as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    let approvalActive = false;
    if (r.metadata && typeof r.metadata === 'object') {
      const m = r.metadata as Record<string, unknown>;
      const rules = m.approvalRules as Record<string, unknown> | undefined;
      if (rules) {
        approvalActive =
          rules.requireApprovalForPosts === true ||
          (Array.isArray(rules.requireApprovalForPostsOnPlatforms) &&
            (rules.requireApprovalForPostsOnPlatforms as unknown[]).length > 0) ||
          (Array.isArray(rules.requireApprovalForCampaignTypes) &&
            (rules.requireApprovalForCampaignTypes as unknown[]).length > 0);
      }
    }
    return {
      brandId: r.brandId,
      brandName: r.brandName,
      brandSlug: r.brandSlug,
      brandVoiceId: r.brandVoiceId,
      voiceName: r.voiceName,
      tone: r.tone,
      languages: langs,
      approvalRulesActive: approvalActive,
    };
  });
}

export interface BrandVoiceDetail {
  readonly id: string;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly name: string;
  readonly tone: string;
  readonly style: string;
  readonly forbiddenWords: ReadonlyArray<string>;
  readonly preferredWords: ReadonlyArray<string>;
  readonly allowedEmojis: ReadonlyArray<string>;
  readonly languages: ReadonlyArray<string>;
  readonly approvalRules: ApprovalRules;
}

export async function getBrandVoiceDetail(opts: {
  orgId: string;
  userId: string;
  brandVoiceId: string;
}): Promise<BrandVoiceDetail | null> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    getBrandVoiceDetailWithTx(tx, {
      orgId: opts.orgId,
      brandVoiceId: opts.brandVoiceId,
    }),
  );
}

export async function getBrandVoiceDetailWithTx(
  tx: AnyPgTx,
  opts: { orgId: string; brandVoiceId: string },
): Promise<BrandVoiceDetail | null> {
  type Row = {
    id: string;
    name: string;
    tone: string | null;
    style: string | null;
    forbiddenWords: unknown;
    preferredWords: unknown;
    allowedEmojis: unknown;
    languages: unknown;
    metadata: unknown;
    brandId: string | null;
    brandName: string | null;
  };
  const rows = (await tx
    .select({
      id: brandVoices.id,
      name: brandVoices.name,
      tone: brandVoices.tone,
      style: brandVoices.style,
      forbiddenWords: brandVoices.forbiddenWords,
      preferredWords: brandVoices.preferredWords,
      allowedEmojis: brandVoices.allowedEmojis,
      languages: brandVoices.languages,
      metadata: brandVoices.metadata,
      brandId: brands.id,
      brandName: brands.name,
    })
    .from(brandVoices)
    .leftJoin(brands, eq(brands.brandVoiceId, brandVoices.id))
    .where(
      and(
        eq(brandVoices.id, opts.brandVoiceId),
        eq(brandVoices.organizationId, opts.orgId),
      ),
    )
    .limit(1)) as Row[];
  const r = rows[0];
  if (!r) return null;

  const rules = extractApprovalRules(r.metadata);

  return {
    id: r.id,
    brandId: r.brandId,
    brandName: r.brandName,
    name: r.name,
    tone: r.tone ?? '',
    style: r.style ?? '',
    forbiddenWords: arrOfStrings(r.forbiddenWords),
    preferredWords: arrOfStrings(r.preferredWords),
    allowedEmojis: arrOfStrings(r.allowedEmojis),
    languages: arrOfStrings(r.languages),
    approvalRules: rules,
  };
}

function arrOfStrings(v: unknown): ReadonlyArray<string> {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter((x): x is string => typeof x === 'string');
}

function extractApprovalRules(metadata: unknown): ApprovalRules {
  if (metadata && typeof metadata === 'object') {
    const m = metadata as Record<string, unknown>;
    const rules = m.approvalRules;
    if (rules && typeof rules === 'object') {
      const r = rules as Record<string, unknown>;
      return {
        requireApprovalForPosts: r.requireApprovalForPosts === true,
        requireApprovalForPostsOnPlatforms: Array.isArray(
          r.requireApprovalForPostsOnPlatforms,
        )
          ? (r.requireApprovalForPostsOnPlatforms.filter(
              (v): v is string => typeof v === 'string',
            ) as Array<ApprovalRules['requireApprovalForPostsOnPlatforms'][number]>)
          : [],
        requireApprovalForCampaignTypes: Array.isArray(
          r.requireApprovalForCampaignTypes,
        )
          ? (r.requireApprovalForCampaignTypes.filter(
              (v): v is string => typeof v === 'string',
            ) as Array<ApprovalRules['requireApprovalForCampaignTypes'][number]>)
          : [],
      };
    }
  }
  return {
    requireApprovalForPosts: false,
    requireApprovalForPostsOnPlatforms: [],
    requireApprovalForCampaignTypes: [],
  };
}
