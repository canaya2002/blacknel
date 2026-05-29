'use client';

import {
  ChevronRight,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { dynamicRoute } from '@/lib/routes';
import { useState, useTransition } from 'react';

import {
  attachToExistingDraftAction,
  createDraftFromAssetAction,
  deleteAssetAction,
  listDraftsForAttachAction,
  type DraftListItem,
} from '@/app/(app)/publish/assets/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import type { AssetListItem } from '@/lib/publish/assets/queries';

interface AssetDetailDrawerProps {
  asset: AssetListItem;
  /** The trigger node — typically the asset tile. The Dialog wraps it. */
  children: React.ReactNode;
}

type DrawerMode = 'overview' | 'pick-draft';

/**
 * Asset detail dialog (19c.3, carry-over de 19b).
 *
 * Displays a large preview + metadata + 3 actions:
 *
 *   - **Usar en post nuevo** — `createDraftFromAssetAction` creates
 *     a fresh draft with this asset attached and redirects the
 *     user to the composer.
 *   - **Usar en post existente** — opens an inner "pick-draft"
 *     view (drafts list) → `attachToExistingDraftAction` on
 *     selection.
 *   - **Eliminar** — `deleteAssetAction`. Disabled when
 *     `usedCount > 0` (deactivation has to flow through the
 *     composer's detach first).
 *
 * The Dialog primitive is wired as `Dialog > DialogTrigger
 * (children) > DialogContent`. The parent (asset-grid) wraps each
 * tile in `<AssetDetailDrawer asset={…}>{tile}</AssetDetailDrawer>`.
 */
export function AssetDetailDrawer({
  asset,
  children,
}: AssetDetailDrawerProps): React.ReactElement {
  const router = useRouter();
  const [mode, setMode] = useState<DrawerMode>('overview');
  const [pendingCreate, startCreate] = useTransition();
  const [pendingDelete, startDelete] = useTransition();
  const [pendingAttach, startAttach] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const onCreateDraft = (): void => {
    setFeedback(null);
    startCreate(async () => {
      const result = await createDraftFromAssetAction(null, { assetId: asset.id });
      if (!result.ok) {
        setFeedback(result.error.message);
        return;
      }
      router.push(dynamicRoute(`/publish/composer/${result.data.postId}`));
    });
  };

  const onDelete = (): void => {
    if (asset.usedCount > 0) return;
    setFeedback(null);
    const ok = window.confirm('¿Eliminar este asset? Esta acción no se puede deshacer.');
    if (!ok) return;
    startDelete(async () => {
      const result = await deleteAssetAction(null, { assetId: asset.id });
      if (!result.ok) {
        setFeedback(result.error.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="line-clamp-1">{asset.name}</DialogTitle>
          <DialogDescription className="text-xs">
            {KIND_LABELS[asset.kind]} · {formatBytes(asset.bytes)} ·{' '}
            usado {asset.usedCount}× · subido el {formatDate(asset.createdAt)}
          </DialogDescription>
        </DialogHeader>

        {mode === 'overview' ? (
          <OverviewBody
            asset={asset}
            pendingCreate={pendingCreate}
            pendingDelete={pendingDelete}
            onCreateDraft={onCreateDraft}
            onPickExisting={() => setMode('pick-draft')}
            onDelete={onDelete}
            feedback={feedback}
          />
        ) : (
          <PickDraftBody
            asset={asset}
            pendingAttach={pendingAttach}
            onBack={() => setMode('overview')}
            onAttach={(postId) => {
              setFeedback(null);
              startAttach(async () => {
                const result = await attachToExistingDraftAction(null, {
                  postId,
                  assetId: asset.id,
                });
                if (!result.ok) {
                  setFeedback(result.error.message);
                  return;
                }
                router.push(dynamicRoute(`/publish/composer/${postId}`));
              });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const KIND_LABELS = {
  image: 'Imagen',
  gif: 'GIF',
  video: 'Video',
  pdf: 'PDF',
} as const;

const KIND_ICONS = {
  image: ImageIcon,
  gif: ImageIcon,
  video: Film,
  pdf: FileText,
} as const;

function OverviewBody({
  asset,
  pendingCreate,
  pendingDelete,
  onCreateDraft,
  onPickExisting,
  onDelete,
  feedback,
}: {
  asset: AssetListItem;
  pendingCreate: boolean;
  pendingDelete: boolean;
  onCreateDraft: () => void;
  onPickExisting: () => void;
  onDelete: () => void;
  feedback: string | null;
}): React.ReactElement {
  const isImage = asset.kind === 'image' || asset.kind === 'gif';
  const Icon = KIND_ICONS[asset.kind];
  const canDelete = asset.usedCount === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border bg-muted">
        {isImage ? (
          /* Dev provider serves local URLs. See media-uploader for rationale. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnailUrl ?? asset.url}
            alt={asset.name}
            className="max-h-96 w-full object-contain"
          />
        ) : asset.kind === 'video' ? (
          <video
            src={asset.url}
            controls
            preload="metadata"
            className="max-h-96 w-full"
          />
        ) : (
          <div className="flex h-48 w-full items-center justify-center text-muted-foreground">
            <Icon className="h-12 w-12" aria-hidden />
          </div>
        )}
      </div>

      {asset.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {asset.tags.map((t) => (
            <Badge key={t} variant="muted" className="text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
      ) : null}

      {feedback ? (
        <p role="alert" className="text-[11px] text-red-600">
          {feedback}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          onClick={onCreateDraft}
          disabled={pendingCreate}
          data-testid="asset-detail-use-in-new"
        >
          {pendingCreate ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          Usar en post nuevo
        </Button>
        <Button
          variant="outline"
          onClick={onPickExisting}
          data-testid="asset-detail-use-in-existing"
        >
          Usar en post existente
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          onClick={onDelete}
          disabled={!canDelete || pendingDelete}
          title={
            !canDelete
              ? `No se puede eliminar: está siendo usado en ${asset.usedCount} post${asset.usedCount === 1 ? '' : 's'}. Desvincúlalo primero.`
              : 'Eliminar asset'
          }
          className={cn('ml-auto text-muted-foreground hover:text-red-600')}
          data-testid="asset-detail-delete"
        >
          {pendingDelete ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden />
          )}
          Eliminar
        </Button>
      </div>
    </div>
  );
}

function PickDraftBody({
  asset,
  pendingAttach,
  onBack,
  onAttach,
}: {
  asset: AssetListItem;
  pendingAttach: boolean;
  onBack: () => void;
  onAttach: (postId: string) => void;
}): React.ReactElement {
  const [drafts, setDrafts] = useState<ReadonlyArray<DraftListItem> | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Lazy-load drafts on first render of this view.
  if (drafts === null && !pending && !error) {
    startTransition(async () => {
      const result = await listDraftsForAttachAction();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setDrafts(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Volver
        </Button>
        <span className="text-xs text-muted-foreground">
          Adjuntar &ldquo;{asset.name}&rdquo; a un borrador
        </span>
      </header>

      {error ? (
        <p role="alert" className="text-[11px] text-red-600">
          {error}
        </p>
      ) : null}

      {pending || drafts === null ? (
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          Cargando borradores…
        </div>
      ) : drafts.length === 0 ? (
        <p className="rounded-md border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
          No hay borradores disponibles. Crea uno con &ldquo;Usar en post nuevo&rdquo;.
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <button
                type="button"
                onClick={() => onAttach(draft.id)}
                disabled={pendingAttach}
                className="flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40 disabled:opacity-60"
              >
                <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                  <span className="line-clamp-1 font-medium">
                    {draft.text.trim().length > 0
                      ? draft.text.slice(0, 80)
                      : '(borrador vacío)'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {draft.status} · {formatDate(new Date(draft.createdAt))}
                  </span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 self-center text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}
