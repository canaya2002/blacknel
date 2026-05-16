'use client';

import { Link as LinkIcon, Tag } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { buildUtmUrl, type UtmValues } from '@/lib/publish/composer/utm';

// Re-export for convenience of consumers that already
// pull the type from this file.
export type { UtmValues };

interface UtmBuilderProps {
  link: string;
  onLinkChange: (next: string) => void;
  utm: UtmValues;
  onUtmChange: (next: UtmValues) => void;
}

const FIELDS: ReadonlyArray<{
  key: keyof UtmValues;
  label: string;
  helper: string;
}> = [
  { key: 'source', label: 'utm_source', helper: 'Origen — facebook, newsletter, etc.' },
  { key: 'medium', label: 'utm_medium', helper: 'Canal — cpc, organic, email.' },
  { key: 'campaign', label: 'utm_campaign', helper: 'Identificador de la campaña.' },
  { key: 'term', label: 'utm_term', helper: 'Palabra clave (opcional, paid).' },
  { key: 'content', label: 'utm_content', helper: 'Variante creativa (opcional).' },
];

/**
 * Link + UTM editor. The "preview de URL" line below the inputs
 * surfaces the final attribution-aware URL that gets injected
 * into the platform's link card field. Empty UTM keys are
 * dropped — `emitUtm()` in the shell strips them before sending
 * to the Server Action.
 *
 * The URL preview uses native `URL` so a malformed link doesn't
 * crash the component — it surfaces an inline hint instead.
 */
export function UtmBuilder({
  link,
  onLinkChange,
  utm,
  onUtmChange,
}: UtmBuilderProps): React.ReactElement {
  const preview = buildUtmUrl(link, utm);

  const setField = (key: keyof UtmValues, value: string): void => {
    onUtmChange({ ...utm, [key]: value });
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <header className="flex items-center gap-2 text-xs text-muted-foreground">
        <LinkIcon className="h-3.5 w-3.5" aria-hidden />
        <span className="font-medium">Enlace y UTM</span>
      </header>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium">URL del enlace</span>
        <Input
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => onLinkChange(e.target.value)}
          placeholder="https://tu-marca.com/landing"
          className="h-8 text-xs"
        />
      </label>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FIELDS.map(({ key, label, helper }) => (
          <label key={key} className="flex flex-col gap-1 text-xs">
            <span className="flex items-center gap-1 font-medium">
              <Tag className="h-3 w-3 text-muted-foreground" aria-hidden />
              {label}
            </span>
            <Input
              value={utm[key] ?? ''}
              onChange={(e) => setField(key, e.target.value)}
              placeholder={helper}
              className="h-8 text-xs"
            />
          </label>
        ))}
      </div>

      <div className={cn(
        'rounded-md border bg-background/50 px-3 py-2 font-mono text-[11px]',
        preview.kind === 'invalid' && 'border-amber-300/60 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100',
        preview.kind === 'empty' && 'text-muted-foreground italic',
      )}>
        {preview.kind === 'ok' ? (
          <span>{preview.url}</span>
        ) : preview.kind === 'invalid' ? (
          <span>URL no válida — corrige el enlace para previsualizar la URL con UTM.</span>
        ) : (
          <span>Sin enlace — los UTM se aplicarán cuando agregues una URL.</span>
        )}
      </div>
    </section>
  );
}

