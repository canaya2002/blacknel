'use client';

import {
  FileText,
  Film,
  ImageIcon,
  Loader2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import { uploadAssetAction } from '@/app/(app)/publish/assets/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import type { AssetListItem } from '@/lib/publish/assets/queries';

interface MediaUploaderProps {
  attached: ReadonlyArray<AssetListItem>;
  onChange: (next: ReadonlyArray<AssetListItem>) => void;
  /**
   * Max attachments — derived from the strictest selected
   * platform's `publishLimits.maxImages + maxVideos`. The composer
   * passes the value already computed across the picker selection.
   * `null` means no platforms selected; the dropzone shows a hint.
   */
  maxAttachments: number | null;
  /**
   * Plan-level per-file size cap in bytes. Used only for client-side
   * pre-flight feedback — the server enforces it again.
   */
  maxFileSizeBytes: number;
  /** Optional brand to associate the upload with. */
  brandId: string | null;
}

const KIND_ICONS = {
  image: ImageIcon,
  gif: ImageIcon,
  video: Film,
  pdf: FileText,
} as const;

/**
 * Drag-drop + click-to-select uploader for the composer. Owns
 * its own "uploading" UI state but defers the canonical attached-
 * asset list to the parent shell (which threads it into
 * `saveDraftAction` via `mediaIds`).
 *
 * Validation pipeline:
 *
 *   1. Browser-level: HTML `accept` attribute restricts the file
 *      picker to known MIME types.
 *   2. Client-level (this component): per-file size cap, supported
 *      extension check, total-count cap.
 *   3. Server-level (`uploadAssetAction` → `uploadAndRecord`):
 *      MIME / extension consistency, plan-level size / count /
 *      storage caps, audit row.
 *
 * Errors surface inline as small chips beneath the dropzone.
 * Already-attached uploads survive a failed batch — only the
 * offending files get rejected.
 */
const ACCEPT_HTML = 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm,application/pdf';
const ACCEPT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp4',
  '.mov',
  '.webm',
  '.pdf',
]);

export function MediaUploader({
  attached,
  onChange,
  maxAttachments,
  maxFileSizeBytes,
  brandId,
}: MediaUploaderProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<ReadonlyArray<string>>([]);

  const remaining =
    maxAttachments === null
      ? null
      : Math.max(0, maxAttachments - attached.length);

  const openPicker = (): void => {
    if (pending) return;
    inputRef.current?.click();
  };

  const onFiles = (files: FileList | null): void => {
    if (!files || files.length === 0) return;
    setErrors([]);

    const candidates: File[] = [];
    const localErrors: string[] = [];

    const allowed =
      remaining === null
        ? files.length
        : Math.min(remaining, files.length);
    if (allowed < files.length && remaining !== null) {
      localErrors.push(
        `Solo puedes adjuntar ${remaining} archivo${remaining === 1 ? '' : 's'} más (límite ${maxAttachments}).`,
      );
    }

    for (let i = 0; i < files.length && candidates.length < allowed; i++) {
      const f = files[i]!;
      const ext = extensionOf(f.name);
      if (!ACCEPT_EXTENSIONS.has(ext)) {
        localErrors.push(`${f.name}: tipo no soportado (${ext || 'sin extensión'}).`);
        continue;
      }
      if (f.size > maxFileSizeBytes) {
        localErrors.push(
          `${f.name}: ${formatMb(f.size)} excede el máximo (${formatMb(maxFileSizeBytes)}).`,
        );
        continue;
      }
      if (f.size === 0) {
        localErrors.push(`${f.name}: archivo vacío.`);
        continue;
      }
      candidates.push(f);
    }

    if (localErrors.length > 0) setErrors(localErrors);
    if (candidates.length === 0) return;

    startTransition(async () => {
      const newlyAttached: AssetListItem[] = [];
      const uploadErrors: string[] = [];
      for (const file of candidates) {
        const formData = new FormData();
        formData.append('file', file);
        if (brandId) formData.append('brandId', brandId);
        const result = await uploadAssetAction(null, formData);
        if (!result.ok) {
          uploadErrors.push(`${file.name}: ${result.error.message}`);
          continue;
        }
        newlyAttached.push({
          id: result.data.assetId,
          kind: result.data.kind,
          name: file.name,
          url: result.data.url,
          thumbnailUrl: null,
          brandId,
          tags: [],
          usedCount: 0,
          bytes: result.data.bytes,
          contentType: file.type,
          storageKey: null,
          createdAt: new Date(),
          approved: true,
        });
      }
      if (newlyAttached.length > 0) {
        onChange([...attached, ...newlyAttached]);
      }
      if (uploadErrors.length > 0) {
        setErrors((prev) => [...prev, ...uploadErrors]);
      }
    });
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    onFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
  };

  const detach = (assetId: string): void => {
    onChange(attached.filter((a) => a.id !== assetId));
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <header className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <ImageIcon className="h-3.5 w-3.5" aria-hidden />
          Media adjunta
        </span>
        <Badge variant="muted" className="text-[10px]">
          {attached.length}
          {maxAttachments !== null ? ` / ${maxAttachments}` : ''}
        </Badge>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_HTML}
        multiple
        className="sr-only"
        onChange={(e) => onFiles(e.target.files)}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        aria-label="Arrastra archivos o haz click para subir"
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center text-sm transition-colors',
          dragOver
            ? 'border-foreground/40 bg-muted/40'
            : 'border-muted-foreground/40 hover:bg-muted/30',
          pending && 'pointer-events-none opacity-70',
        )}
      >
        {pending ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
        )}
        <span className="font-medium">
          {pending ? 'Subiendo…' : 'Arrastra archivos aquí o haz click'}
        </span>
        <span className="text-[11px] text-muted-foreground">
          Hasta {formatMb(maxFileSizeBytes)} por archivo · PNG / JPG / GIF /
          WEBP / MP4 / MOV / WEBM / PDF
        </span>
      </div>

      {errors.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100">
          {errors.map((e, i) => (
            <li key={i} className="flex items-start gap-1">
              <X className="mt-[1px] h-3 w-3 shrink-0" aria-hidden />
              <span>{e}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {attached.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attached.map((asset) => (
            <li key={asset.id}>
              <AttachmentTile asset={asset} onRemove={() => detach(asset.id)} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function AttachmentTile({
  asset,
  onRemove,
}: {
  asset: AssetListItem;
  onRemove: () => void;
}): React.ReactElement {
  const isImage = asset.kind === 'image' || asset.kind === 'gif';
  const Icon = KIND_ICONS[asset.kind];
  return (
    <div className="group relative flex flex-col gap-1 rounded-md border bg-background p-1.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-muted">
        {isImage ? (
          /* Dev provider serves local `/api/dev-uploads/...`; next/image
             would need a remotePatterns entry. Phase 11 swaps to signed
             Supabase URLs and revisits. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnailUrl ?? asset.url}
            alt={asset.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Icon className="h-6 w-6" aria-hidden />
          </div>
        )}
        <Button
          type="button"
          size="icon"
          variant="destructive"
          className="absolute right-1 top-1 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={onRemove}
          aria-label={`Quitar ${asset.name}`}
        >
          <Trash2 className="h-3 w-3" aria-hidden />
        </Button>
      </div>
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        <span className="line-clamp-1 text-[11px] font-medium" title={asset.name}>
          {asset.name}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatMb(asset.bytes)}
        </span>
      </div>
    </div>
  );
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.slice(idx).toLowerCase();
}

function formatMb(bytes: number): string {
  if (bytes < 1_000_000) {
    const kb = bytes / 1_000;
    return `${kb.toFixed(0)} KB`;
  }
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
