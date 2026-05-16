'use client';

import { ArrowLeft, Loader2, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { saveDraftAction, setPostTargetsAction } from '@/app/(app)/publish/composer/[id]/actions';
import { cn } from '@/lib/utils/cn';
import type { AssetListItem } from '@/lib/publish/assets/queries';
import {
  computeAccountUsages,
  getPublishLimitsFor,
  isWithinAllLimits,
} from '@/lib/publish/composer/character-limits';
import type { ComposerData } from '@/lib/publish/composer/loader';
import {
  emitUtm,
  normalizeUtm,
  utmDiffers,
  type UtmValues,
} from '@/lib/publish/composer/utm';
import { getPlanLimit } from '@/lib/plans/limits';
import type { PlanCode } from '@/lib/plans/plans';

import { AccountPicker } from './account-picker';
import { CancelButton } from './cancel-button';
import { CharacterLimitsBar } from './character-limits-bar';
import { MediaUploader } from './media-uploader';
import { PlatformVariants } from './platform-variants';
import { TextEditor } from './text-editor';
import { UtmBuilder } from './utm-builder';

interface ComposerShellProps {
  data: ComposerData;
  planCode: PlanCode;
}

/**
 * Client-side state hub for the composer (Commit 19a skeleton).
 *
 * Local React state is the *editing* truth — the user can mutate
 * text / link / UTM / picker selection / per-platform variants
 * locally. The server-side row is updated on explicit "Save
 * borrador" (text/link/utm/campaign via `saveDraftAction`, picker
 * via `setPostTargetsAction`).
 *
 * Schedule, preview, media, AI caption, compliance pill, approval
 * rule wiring land in subsequent sub-commits (19b/19c). The shell
 * already reserves the right-hand column so adding those modules
 * is purely a fill-in operation.
 *
 * Dirty-state navigation guard (Ajuste 4 deferral): the `Cancel`
 * button currently fires a simple toast on click; the full
 * `beforeunload` + auto-save flow lands in Commit 21
 * (TODO composer-dirty-state-guard).
 */
export function ComposerShell({ data, planCode }: ComposerShellProps): React.ReactElement {
  const router = useRouter();
  const [savingDraft, startSaveDraft] = useTransition();
  const [savingTargets, startSaveTargets] = useTransition();
  const [feedback, setFeedback] = useState<
    { kind: 'ok' | 'error'; text: string } | null
  >(null);

  // ---------------------------------------------------------------
  // Local editing state
  // ---------------------------------------------------------------
  const [text, setText] = useState<string>(data.postDetail.text);
  const [link, setLink] = useState<string>(data.postDetail.link ?? '');
  // Campaign change UI lands in 19c (it lives outside the composer
  // body, in a sidebar dropdown). For 19a the persisted campaign
  // flows through the save action read-only — preserved unchanged.
  const campaignId = data.postDetail.campaignId;
  const [utm, setUtm] = useState<UtmValues>(() => normalizeUtm(data.postDetail.utm));
  const [selectedAccountIds, setSelectedAccountIds] = useState<ReadonlyArray<string>>(
    () =>
      data.postDetail.targets
        .filter((t) => t.status !== 'failed')
        .map((t) => t.connectedAccountId),
  );
  const [variants, setVariants] = useState<Readonly<Record<string, string | undefined>>>(
    () => initialVariants(data),
  );
  const [attachedAssets, setAttachedAssets] = useState<ReadonlyArray<AssetListItem>>(
    () => data.attachedAssets,
  );

  // ---------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------
  const selectedAccounts = useMemo(
    () =>
      selectedAccountIds
        .map((id) => data.publishCapableAccounts.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => a !== undefined),
    [selectedAccountIds, data.publishCapableAccounts],
  );

  const usages = useMemo(
    () =>
      computeAccountUsages({
        baseText: text,
        variants,
        accounts: selectedAccounts.map((a) => ({
          accountId: a.id,
          platform: a.platform,
        })),
      }),
    [text, variants, selectedAccounts],
  );

  const withinLimits = useMemo(
    () =>
      isWithinAllLimits({
        baseText: text,
        variants,
        accounts: selectedAccounts.map((a) => ({
          accountId: a.id,
          platform: a.platform,
        })),
      }),
    [text, variants, selectedAccounts],
  );

  // ---------------------------------------------------------------
  // Diff vs persisted state (drives "Guardar" disable + dirty flag)
  // ---------------------------------------------------------------
  const persistedAccountIds = useMemo(
    () =>
      new Set(
        data.postDetail.targets
          .filter((t) => t.status !== 'failed')
          .map((t) => t.connectedAccountId),
      ),
    [data.postDetail.targets],
  );
  const selectedAccountSet = useMemo(
    () => new Set(selectedAccountIds),
    [selectedAccountIds],
  );
  const accountsDirty = useMemo(() => {
    if (persistedAccountIds.size !== selectedAccountSet.size) return true;
    for (const id of selectedAccountSet) if (!persistedAccountIds.has(id)) return true;
    return false;
  }, [persistedAccountIds, selectedAccountSet]);
  const draftDirty =
    text !== data.postDetail.text ||
    link !== (data.postDetail.link ?? '') ||
    utmDiffers(utm, data.postDetail.utm) ||
    mediaIdsDiffer(attachedAssets, data.postDetail.mediaIds);
  const dirty = draftDirty || accountsDirty;

  // ---------------------------------------------------------------
  // Media uploader constraints
  // ---------------------------------------------------------------
  const maxAttachments = useMemo(() => {
    if (selectedAccounts.length === 0) return null;
    let min: number | null = null;
    for (const account of selectedAccounts) {
      const limits = getPublishLimitsFor(account.platform);
      const total =
        (limits?.maxImages ?? Infinity) + (limits?.maxVideos ?? Infinity);
      const capped = Number.isFinite(total) ? total : 20;
      min = min === null ? capped : Math.min(min, capped);
    }
    return min;
  }, [selectedAccounts]);
  const maxFileSizeBytes = useMemo(
    () => Math.max(1, getPlanLimit(planCode, 'maxAssetSizeBytes')),
    [planCode],
  );

  // ---------------------------------------------------------------
  // Action wiring
  // ---------------------------------------------------------------
  const onSaveDraft = (): void => {
    setFeedback(null);
    startSaveDraft(async () => {
      const result = await saveDraftAction(null, {
        postId: data.postDetail.id,
        text,
        link: link.trim().length === 0 ? null : link.trim(),
        utm: emitUtm(utm),
        campaignId,
        mediaIds: attachedAssets.map((a) => a.id),
      });
      if (!result.ok) {
        setFeedback({ kind: 'error', text: result.error.message });
        return;
      }
      if (accountsDirty) {
        startSaveTargets(async () => {
          const targetsResult = await setPostTargetsAction(null, {
            postId: data.postDetail.id,
            accountIds: [...selectedAccountIds],
          });
          if (!targetsResult.ok) {
            setFeedback({ kind: 'error', text: targetsResult.error.message });
            return;
          }
          setFeedback({ kind: 'ok', text: 'Borrador guardado.' });
          router.refresh();
        });
      } else {
        setFeedback({ kind: 'ok', text: 'Borrador guardado.' });
        router.refresh();
      }
    });
  };

  const saving = savingDraft || savingTargets;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <Button asChild size="icon" variant="ghost" className="h-8 w-8">
            <Link href="/publish" prefetch={false} aria-label="Volver al calendario">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <h1 className="text-base font-semibold tracking-tight">
            Editor de post
          </h1>
          <Badge variant="muted" className="text-[10px] uppercase">
            {data.postDetail.status}
          </Badge>
          {dirty ? (
            <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100 text-[10px]">
              Sin guardar
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {feedback ? (
            <span
              role="status"
              className={cn(
                'text-xs',
                feedback.kind === 'ok' ? 'text-emerald-600' : 'text-red-600',
              )}
            >
              {feedback.text}
            </span>
          ) : null}
          <CancelButton dirty={dirty} />
          <Button onClick={onSaveDraft} disabled={!dirty || saving || !withinLimits}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            Guardar borrador
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 px-6 pb-6 lg:grid-cols-[1fr_24rem]">
        {/* Left column — editor */}
        <div className="flex flex-col gap-4">
          <TextEditor
            value={text}
            onChange={setText}
            selectedAccounts={selectedAccounts.map((a) => ({
              accountId: a.id,
              platform: a.platform,
            }))}
          />
          <CharacterLimitsBar usages={usages} />
          <AccountPicker
            accounts={data.publishCapableAccounts}
            selected={selectedAccountIds}
            onChange={setSelectedAccountIds}
          />
          <PlatformVariants
            selectedAccounts={selectedAccounts}
            baseText={text}
            variants={variants}
            onChange={setVariants}
          />
          <MediaUploader
            attached={attachedAssets}
            onChange={setAttachedAssets}
            maxAttachments={maxAttachments}
            maxFileSizeBytes={maxFileSizeBytes}
            brandId={data.postDetail.brandId}
          />
          <UtmBuilder
            link={link}
            onLinkChange={setLink}
            utm={utm}
            onUtmChange={setUtm}
          />
        </div>

        {/* Right column — preview placeholder (19c) + schedule placeholder (19c) */}
        <aside className="flex flex-col gap-4">
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            <h3 className="mb-1 text-sm font-semibold text-foreground">Vista previa</h3>
            <p>
              Las previews fieles por plataforma (Facebook, Instagram, GBP) y la
              versión genérica para el resto llegan en el sub-commit 19c.
            </p>
          </div>
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            <h3 className="mb-1 text-sm font-semibold text-foreground">Programar</h3>
            <p>
              El control de fecha/hora en {data.orgTimezone}, junto con el AI
              caption stub y el compliance pill, llegan en 19c.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mediaIdsDiffer(
  attached: ReadonlyArray<AssetListItem>,
  persisted: ReadonlyArray<string>,
): boolean {
  if (attached.length !== persisted.length) return true;
  for (let i = 0; i < attached.length; i++) {
    if (attached[i]?.id !== persisted[i]) return true;
  }
  return false;
}

function initialVariants(data: ComposerData): Readonly<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  for (const target of data.postDetail.targets) {
    const variant = target.platformVariant;
    if (variant && typeof variant === 'object' && 'text' in variant) {
      const v = (variant as { text?: unknown }).text;
      if (typeof v === 'string' && v.length > 0) {
        out[target.connectedAccountId] = v;
      }
    }
  }
  return out;
}
