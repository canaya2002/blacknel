'use client';

import { Languages } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import type { PlatformCode } from '@/lib/connectors/base';
import {
  getPublishLimitsFor,
} from '@/lib/publish/composer/character-limits';
import type { PublishCapableAccount } from '@/lib/publish/composer/queries';

interface PlatformVariantsProps {
  selectedAccounts: ReadonlyArray<PublishCapableAccount>;
  baseText: string;
  variants: Readonly<Record<string, string | undefined>>;
  onChange: (next: Readonly<Record<string, string | undefined>>) => void;
}

const PLATFORM_SHORT: Partial<Record<PlatformCode, string>> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  gbp: 'GBP',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
};

/**
 * Per-account text variant editor. Sub-tabbed under the picker:
 * each selected account is its own tab. The variant defaults to
 * the empty string ("inherit base text"); setting any non-empty
 * value overrides the base for that account.
 *
 * Variants persist with the post via `post_targets.platform_variant`
 * jsonb (`{ text?: string, link?: string, mediaIds?: string[] }`).
 * Commit 19a only writes `text` — link and media overrides land
 * with the media uploader (19b).
 *
 * The shell coordinates per-target saves: variants flow with the
 * "Guardar borrador" CTA at the top. A later commit may move
 * variants to a dedicated save action to avoid coupling
 * text/link/utm changes with variant changes.
 */
export function PlatformVariants({
  selectedAccounts,
  baseText,
  variants,
  onChange,
}: PlatformVariantsProps): React.ReactElement | null {
  const [activeId, setActiveId] = useState<string | null>(
    selectedAccounts[0]?.id ?? null,
  );

  if (selectedAccounts.length === 0) return null;

  // If the active account was deselected upstream, fall back to
  // the first remaining account.
  const safeActiveId = selectedAccounts.find((a) => a.id === activeId)?.id ??
    selectedAccounts[0]?.id ??
    null;
  const active = selectedAccounts.find((a) => a.id === safeActiveId);
  if (!active) return null;

  const limit = getPublishLimitsFor(active.platform)?.maxTextLength ?? null;
  const variant = variants[active.id] ?? '';
  const effective = variant.length > 0 ? variant : baseText;
  const over = limit !== null && effective.length > limit;

  const setVariantText = (next: string): void => {
    const updated = { ...variants };
    if (next.trim().length === 0) {
      delete updated[active.id];
    } else {
      updated[active.id] = next;
    }
    onChange(updated);
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <header className="flex items-center gap-2 text-xs text-muted-foreground">
        <Languages className="h-3.5 w-3.5" aria-hidden />
        <span className="font-medium">Variante por red</span>
      </header>
      <nav
        role="tablist"
        aria-label="Cuentas seleccionadas"
        className="flex flex-wrap items-center gap-1 border-b pb-2"
      >
        {selectedAccounts.map((account) => {
          const isActive = account.id === safeActiveId;
          const hasOverride = (variants[account.id] ?? '').length > 0;
          return (
            <button
              key={account.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(account.id)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                isActive
                  ? 'border-foreground/40 bg-muted'
                  : 'border-transparent hover:bg-muted/40',
              )}
            >
              <span>
                {PLATFORM_SHORT[account.platform] ?? account.platform} ·{' '}
                {account.displayName ?? account.handle ?? account.id.slice(0, 6)}
              </span>
              {hasOverride ? (
                <Badge variant="muted" className="h-4 px-1 text-[10px]">
                  override
                </Badge>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="flex flex-col gap-1">
        <Textarea
          value={variant}
          onChange={(e) => setVariantText(e.target.value)}
          rows={4}
          placeholder={
            variant.length === 0
              ? `(Heredando texto base — escribe aquí para sobre-escribir solo en ${PLATFORM_SHORT[active.platform] ?? active.platform}.)`
              : ''
          }
          aria-label={`Variante para ${active.displayName ?? active.platform}`}
          className={cn(
            'resize-y',
            over && 'border-red-300 focus-visible:ring-red-400',
          )}
        />
        <span
          className={cn(
            'text-[11px] tabular-nums',
            over ? 'text-red-600' : 'text-muted-foreground',
          )}
        >
          {effective.length}
          {limit !== null ? ` / ${limit}` : ''}
        </span>
      </div>
    </section>
  );
}
