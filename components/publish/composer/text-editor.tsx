'use client';

import { Type } from 'lucide-react';

import { Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import {
  strictestMaxLength,
  type AccountLimitInput,
} from '@/lib/publish/composer/character-limits';

interface TextEditorProps {
  value: string;
  onChange: (next: string) => void;
  selectedAccounts: ReadonlyArray<AccountLimitInput>;
}

/**
 * Base post-body editor. Calculates the strictest limit across
 * the selected accounts and shows a `X / N` counter beneath the
 * textarea — red when over the strictest cap, amber when within
 * 10% of it, neutral otherwise.
 *
 * The textarea is uncontrolled-style (passes value up via
 * `onChange`); the parent (`ComposerShell`) owns the canonical
 * editing state.
 */
export function TextEditor({
  value,
  onChange,
  selectedAccounts,
}: TextEditorProps): React.ReactElement {
  const maxLength = strictestMaxLength(selectedAccounts);
  const length = value.length;
  const over = maxLength !== null && length > maxLength;
  const nearLimit =
    maxLength !== null && length > maxLength * 0.9 && length <= maxLength;

  return (
    <section className="flex flex-col gap-1.5 rounded-lg border bg-card p-4">
      <header className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Type className="h-3.5 w-3.5" aria-hidden />
          Contenido del post
        </span>
        <span
          aria-live="polite"
          className={cn(
            'tabular-nums',
            over
              ? 'text-red-600'
              : nearLimit
                ? 'text-amber-600'
                : 'text-muted-foreground',
          )}
        >
          {length}
          {maxLength !== null ? ` / ${maxLength}` : ''}
        </span>
      </header>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        placeholder="Escribe tu mensaje base. Las variantes por red lo pueden sobre-escribir más abajo."
        aria-label="Contenido del post"
        className={cn(
          'resize-y',
          over && 'border-red-300 focus-visible:ring-red-400',
        )}
      />
      <p className="text-[11px] text-muted-foreground">
        El conteo aplica la red con menor límite entre las cuentas
        seleccionadas. Si una red excede el límite, no podrás
        guardar hasta que ajustes el texto o su variante.
      </p>
    </section>
  );
}
