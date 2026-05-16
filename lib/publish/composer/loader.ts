import 'server-only';

import { dbAs } from '@/lib/db/client';

import {
  getOrgTimezoneWithTx,
  listBrandOptionsWithTx,
  listCampaignOptionsWithTx,
  type BrandOption,
  type CampaignOption,
  type OrgPresentation,
} from '@/lib/publish/picker-data';
import { getPostDetail, type PostDetail } from '@/lib/publish/queries';

import {
  listPublishCapableAccountsWithTx,
  type PublishCapableAccount,
} from './queries';

/**
 * Single-pass loader for the composer page. Same shape as the C18
 * dashboard loader: one `dbAs`, one `Promise.all`, a DI bag for
 * the contract test, and a `*WithTx` sibling for the test.
 *
 * Composer-specific scope (different from the dashboard):
 *
 *   - `postDetail` is the single source of truth for editor state —
 *     text, link, utm, scheduledAt, current targets.
 *   - `publishCapableAccounts` is scoped to the post's brand if
 *     present (so changing the brand in the composer would trigger
 *     a reload and the picker re-renders against the new brand's
 *     accounts).
 *   - `brandOptions` / `campaignOptions` feed the "change brand /
 *     campaign" dropdowns inside the editor.
 *
 * Returns `null` for `postDetail` when the post doesn't exist or
 * isn't visible to the caller — the page renders a 404 in that
 * case.
 */

export interface ComposerData {
  readonly postDetail: PostDetail;
  readonly publishCapableAccounts: ReadonlyArray<PublishCapableAccount>;
  readonly brandOptions: ReadonlyArray<BrandOption>;
  readonly campaignOptions: ReadonlyArray<CampaignOption>;
  readonly orgTimezone: string;
  readonly orgLocale: string;
}

export interface LoadComposerDataOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly postId: string;
}

export async function loadComposerData(
  opts: LoadComposerDataOpts,
): Promise<ComposerData | null> {
  // `getPostDetail` opens its own `dbAs`. We could refactor it to
  // accept an existing tx and roll into the Promise.all below, but
  // for now the extra read is cheap and keeps the existing C17
  // contract intact.
  const postDetail = await getPostDetail({
    orgId: opts.orgId,
    userId: opts.userId,
    postId: opts.postId,
  });
  if (!postDetail) return null;

  const [accounts, brandOptions, campaignOptions, presentation] = await dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      Promise.all([
        listPublishCapableAccountsWithTx(tx, {
          orgId: opts.orgId,
          userId: opts.userId,
          ...(postDetail.brandId ? { brandId: postDetail.brandId } : {}),
        }),
        listBrandOptionsWithTx(tx, opts.orgId),
        listCampaignOptionsWithTx(tx, opts.orgId),
        getOrgTimezoneWithTx(tx, opts.orgId),
      ] as const),
  );

  const out: ComposerData = {
    postDetail,
    publishCapableAccounts: accounts,
    brandOptions,
    campaignOptions,
    orgTimezone: presentation.timezone,
    orgLocale: presentation.locale,
  };
  return out;
}

// Touch the export so a future PR that renames or removes
// `OrgPresentation` doesn't silently break the loader's contract.
void (null as unknown as OrgPresentation | null);
