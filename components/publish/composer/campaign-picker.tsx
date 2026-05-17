'use client';

import { AlertCircle, Check, ChevronsUpDown, Loader2, Megaphone, X } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';

import { setPostCampaignAction } from '@/app/(app)/publish/campaigns/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { CampaignOption } from '@/lib/publish/picker-data';
import { cn } from '@/lib/utils/cn';

interface CampaignPickerProps {
  postId: string;
  /** Currently selected campaign id, or null when unattached. */
  selectedCampaignId: string | null;
  /** Brand the post belongs to. Drives which campaigns are pickable. */
  postBrandId: string | null;
  /** All campaign options visible to the org. Filtered client-side. */
  campaignOptions: ReadonlyArray<CampaignOption>;
}

/**
 * Composer campaign-picker (Commit 21). Server Action backed
 * (`setPostCampaignAction`) so the wire-up survives reload and
 * the audit log captures every link/unlink. Filters client-side:
 *
 *   1. Campaign brand matches the post's brand (or campaign has
 *      no brand — global campaigns).
 *   2. Status is `'draft'` or `'active'` (cannot attach to a
 *      paused / completed / archived campaign — server rejects too,
 *      but UI hides them to avoid the surprise).
 *
 * The popover surfaces a search box for orgs with many campaigns;
 * an empty search shows the first 20.
 *
 * TODO composer-campaign-picker-multi-brand (Phase 12) — when the
 * user changes the post's brand mid-edit, the loader doesn't
 * refresh; the picker still shows the old brand's campaigns
 * until the page reloads.
 */
export function CampaignPicker({
  postId,
  selectedCampaignId,
  postBrandId,
  campaignOptions,
}: CampaignPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pickable = useMemo(
    () =>
      campaignOptions.filter((c) => {
        // Status gate.
        if (c.status !== 'draft' && c.status !== 'active') return false;
        // Brand match — `null` brand = global campaign, fits any post.
        if (c.brandId !== null && postBrandId !== null && c.brandId !== postBrandId) {
          return false;
        }
        return true;
      }),
    [campaignOptions, postBrandId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q.length === 0 ? pickable : pickable.filter((c) => c.name.toLowerCase().includes(q));
    return list.slice(0, 20);
  }, [pickable, query]);

  const selected = useMemo(
    () => campaignOptions.find((c) => c.id === selectedCampaignId) ?? null,
    [campaignOptions, selectedCampaignId],
  );

  const update = (nextId: string | null): void => {
    setError(null);
    setOpen(false);
    startTransition(async () => {
      const result = await setPostCampaignAction(null, {
        postId,
        campaignId: nextId,
      });
      if (!result.ok) {
        setError(result.error.message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Megaphone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Campaña
        </span>
        {selected ? (
          <Badge variant="muted" className="text-[10px] uppercase">
            {selected.status}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              role="combobox"
              aria-expanded={open}
              disabled={pending}
              className="w-72 justify-between text-xs"
              data-testid="composer-campaign-picker"
            >
              <span className={cn(!selected && 'text-muted-foreground')}>
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : selected ? (
                  selected.name
                ) : (
                  'Sin campaña asociada'
                )}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <input
              type="text"
              placeholder="Buscar campaña…"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              className="mb-2 w-full rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-1"
            />
            <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  {pickable.length === 0
                    ? 'No hay campañas disponibles para esta marca.'
                    : 'Sin coincidencias.'}
                </li>
              ) : (
                filtered.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => update(c.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted',
                        c.id === selectedCampaignId && 'bg-muted',
                      )}
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="flex items-center gap-1.5">
                        <Badge variant="muted" className="text-[10px] uppercase">
                          {c.status}
                        </Badge>
                        {c.id === selectedCampaignId ? (
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </PopoverContent>
        </Popover>
        {selected ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => update(null)}
            disabled={pending}
            title="Quitar campaña"
            className="h-8 px-2"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
      {error ? (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" aria-hidden />
          {error}
        </span>
      ) : null}
    </div>
  );
}
