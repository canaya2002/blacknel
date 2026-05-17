'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { addCompetitorAction } from '@/app/(app)/competitors/actions';
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

/**
 * Add-competitor form (Phase 9 / Commit 34).
 */
export function CompetitorForm(): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState('');
  const [platforms, setPlatforms] = useState<ReadonlyArray<string>>([
    'instagram',
    'x',
  ]);
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const togglePlatform = (p: string): void => {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const setHandle = (platform: string, value: string): void => {
    setHandles((prev) => ({ ...prev, [platform]: value }));
  };

  const submit = (): void => {
    if (name.trim().length === 0) {
      setError('Dale un nombre al competidor.');
      return;
    }
    if (platforms.length === 0) {
      setError('Seleccioná al menos una plataforma.');
      return;
    }
    setError(null);
    const handlesPayload: Record<string, string> = {};
    for (const p of platforms) {
      const h = handles[p]?.trim();
      if (h) handlesPayload[p] = h;
    }
    startTransition(async () => {
      const result = await addCompetitorAction(null, {
        name: name.trim(),
        platforms,
        ...(Object.keys(handlesPayload).length > 0
          ? { handles: handlesPayload }
          : {}),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push('/competitors');
    });
  };

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Nombre del competidor
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Ej: Marca Rival"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-testid="competitor-name"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Plataformas y handles
        </span>
        <div className="flex flex-col gap-2">
          {PLATFORMS.map((p) => {
            const active = platforms.includes(p);
            return (
              <div key={p} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => togglePlatform(p)}
                  data-testid={`competitor-platform-${p}`}
                  className={
                    active
                      ? 'w-28 rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
                      : 'w-28 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground'
                  }
                >
                  {p}
                </button>
                <input
                  disabled={!active}
                  value={handles[p] ?? ''}
                  onChange={(e) => setHandle(p, e.target.value)}
                  placeholder={active ? `@handle en ${p}` : ''}
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-50"
                />
              </div>
            );
          })}
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
          data-testid="competitor-submit"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Creando…
            </>
          ) : (
            'Crear competidor'
          )}
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}
