'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { addTrackedTermAction } from '@/app/(app)/listening/actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const PLATFORMS = [
  'facebook',
  'instagram',
  'x',
  'reddit',
  'tiktok',
  'linkedin',
] as const;

type TermKind = 'keyword' | 'hashtag' | 'handle';

/**
 * Add-tracked-term form (Phase 9 / Commit 33).
 *
 * Used from `/listening/terms/new`. The first scan-tick after the
 * cron's 60-min cadence will populate mentions; until then the
 * Mentions tab stays empty for this term.
 */
export function TrackedTermForm(): React.ReactElement {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [termKind, setTermKind] = useState<TermKind>('keyword');
  const [platforms, setPlatforms] = useState<ReadonlyArray<string>>([
    'x',
    'instagram',
  ]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const togglePlatform = (p: string): void => {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const submit = (): void => {
    if (term.trim().length === 0) {
      setError('Escribe un término.');
      return;
    }
    if (platforms.length === 0) {
      setError('Seleccioná al menos una plataforma.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addTrackedTermAction(null, {
        term: term.trim(),
        termKind,
        platforms,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push('/listening?tab=terms');
    });
  };

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Término
        </label>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          maxLength={120}
          placeholder={
            termKind === 'hashtag'
              ? '#mibarrio'
              : termKind === 'handle'
                ? '@mibrand'
                : 'mi-producto'
          }
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-testid="tracked-term-input"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Tipo
        </label>
        <select
          value={termKind}
          onChange={(e) => setTermKind(e.target.value as TermKind)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-testid="tracked-term-kind"
        >
          <option value="keyword">Keyword (texto libre)</option>
          <option value="hashtag">Hashtag (#foo)</option>
          <option value="handle">Handle (@foo)</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Plataformas
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePlatform(p)}
              data-testid={`tracked-term-platform-${p}`}
              className={
                platforms.includes(p)
                  ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
                  : 'rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/40'
              }
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          onClick={submit}
          disabled={pending}
          data-testid="tracked-term-submit"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Creando…
            </>
          ) : (
            'Crear término'
          )}
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}
