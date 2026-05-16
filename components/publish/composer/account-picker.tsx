'use client';

import { CheckSquare, Square, Users } from 'lucide-react';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type { PlatformCode } from '@/lib/connectors/base';
import type { PublishCapableAccount } from '@/lib/publish/composer/queries';

interface AccountPickerProps {
  accounts: ReadonlyArray<PublishCapableAccount>;
  selected: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
}

const PLATFORM_LABELS: Partial<Record<PlatformCode, string>> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  gbp: 'Google Business Profile',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
};

/**
 * Multi-select picker for `publish_post` / `schedule_post`-capable
 * accounts. Grouped by platform for visual scan; clicking a row
 * toggles inclusion. The composer ships a Save button that calls
 * `setPostTargetsAction` to commit the selection — this picker
 * stays local-only.
 *
 * Empty state shows when the brand has no publish-capable
 * accounts connected — points the user at /integrations.
 */
export function AccountPicker({
  accounts,
  selected,
  onChange,
}: AccountPickerProps): React.ReactElement {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const grouped = useMemo(() => {
    const byPlatform = new Map<PlatformCode, PublishCapableAccount[]>();
    for (const account of accounts) {
      const bucket = byPlatform.get(account.platform) ?? [];
      bucket.push(account);
      byPlatform.set(account.platform, bucket);
    }
    return Array.from(byPlatform.entries()).sort((a, b) =>
      (PLATFORM_LABELS[a[0]] ?? a[0]).localeCompare(
        PLATFORM_LABELS[b[0]] ?? b[0],
      ),
    );
  }, [accounts]);

  const toggle = (id: string): void => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  if (accounts.length === 0) {
    return (
      <section className="rounded-lg border border-dashed bg-card/30 p-6 text-center">
        <Users className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Sin cuentas para publicar</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Conecta una cuenta con capability de publicar en{' '}
          <a className="underline" href="/integrations">
            /integrations
          </a>{' '}
          para usar el composer.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <header className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Users className="h-3.5 w-3.5" aria-hidden />
          Cuentas destino
        </span>
        <Badge variant="muted" className="text-[10px]">
          {selected.length} / {accounts.length}
        </Badge>
      </header>
      <ul className="flex flex-col gap-3">
        {grouped.map(([platform, group]) => (
          <li key={platform} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {PLATFORM_LABELS[platform] ?? platform}
            </span>
            <ul className="flex flex-col gap-1">
              {group.map((account) => {
                const checked = selectedSet.has(account.id);
                return (
                  <li key={account.id}>
                    <button
                      type="button"
                      onClick={() => toggle(account.id)}
                      aria-pressed={checked}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                        checked
                          ? 'border-foreground/30 bg-muted/60'
                          : 'border-transparent hover:bg-muted/40',
                      )}
                    >
                      {checked ? (
                        <CheckSquare className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Square className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      )}
                      <span className="font-medium">
                        {account.displayName ?? '(sin nombre)'}
                      </span>
                      {account.handle ? (
                        <span className="text-muted-foreground">{account.handle}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
