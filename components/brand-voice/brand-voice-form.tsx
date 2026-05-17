'use client';

import { AlertCircle, Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createBrandVoiceAction,
  updateBrandVoiceAction,
} from '@/app/(app)/settings/brand-voice/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CAMPAIGN_GOALS, type CampaignGoal } from '@/lib/campaigns/validate';
import { PLATFORMS, type PlatformCode } from '@/lib/connectors/base';
import {
  brandVoiceFormSchema,
  parseCsv,
  type ApprovalRules,
  type BrandVoiceFormInput,
} from '@/lib/brand-voice/validate';
import type { BrandVoiceDetail } from '@/lib/brand-voice/queries';

interface BrandVoiceFormProps {
  brandId: string;
  initial: BrandVoiceDetail | null;
}

const ALL_LANGUAGES = [
  { code: 'es' as const, label: 'Español' },
  { code: 'en' as const, label: 'English' },
  { code: 'pt' as const, label: 'Português' },
  { code: 'fr' as const, label: 'Français' },
];

/**
 * Brand-voice editor (Commit 26 / D-26-1).
 *
 * Single form for create + edit. Textarea CSV inputs for word
 * lists and emoji list — fast bulk-edit ergonomics; chips/tags
 * input deferred to Phase-12 polish.
 *
 * Submit re-parses the Zod schema client-side for fast feedback,
 * then awaits the Server Action which re-validates the same
 * schema server-side. The Server Action returns
 * `Result<{ brandVoiceId }>`; errors surface field-by-field
 * via `formErrors`.
 */
export function BrandVoiceForm({
  brandId,
  initial,
}: BrandVoiceFormProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? '');
  const [tone, setTone] = useState(initial?.tone ?? '');
  const [style, setStyle] = useState(initial?.style ?? '');
  const [forbidden, setForbidden] = useState(
    (initial?.forbiddenWords ?? []).join(', '),
  );
  const [preferred, setPreferred] = useState(
    (initial?.preferredWords ?? []).join(', '),
  );
  const [emojis, setEmojis] = useState(
    (initial?.allowedEmojis ?? []).join(', '),
  );
  const [languages, setLanguages] = useState<ReadonlyArray<'es' | 'en' | 'pt' | 'fr'>>(
    (initial?.languages ?? ['es']) as ReadonlyArray<'es' | 'en' | 'pt' | 'fr'>,
  );
  const [requireAll, setRequireAll] = useState(
    initial?.approvalRules.requireApprovalForPosts ?? false,
  );
  const [requirePlatforms, setRequirePlatforms] = useState<ReadonlyArray<PlatformCode>>(
    (initial?.approvalRules.requireApprovalForPostsOnPlatforms ?? []) as ReadonlyArray<PlatformCode>,
  );
  const [requireGoals, setRequireGoals] = useState<ReadonlyArray<CampaignGoal>>(
    (initial?.approvalRules.requireApprovalForCampaignTypes ?? []) as ReadonlyArray<CampaignGoal>,
  );

  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setError(null);

    const formInput: BrandVoiceFormInput = {
      name: name.trim(),
      tone: tone.trim(),
      style: style.trim(),
      forbiddenWords: parseCsv(forbidden) as string[],
      preferredWords: parseCsv(preferred) as string[],
      allowedEmojis: parseCsv(emojis) as string[],
      languages: languages as Array<'es' | 'en' | 'pt' | 'fr'>,
      approvalRules: {
        requireApprovalForPosts: requireAll,
        requireApprovalForPostsOnPlatforms: requirePlatforms as PlatformCode[],
        requireApprovalForCampaignTypes: requireGoals as CampaignGoal[],
      } as ApprovalRules,
    };

    const parsed = brandVoiceFormSchema.safeParse(formInput);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const fieldErrors = flat.fieldErrors as Record<string, string[] | undefined>;
      const firstField = Object.keys(fieldErrors)[0];
      const firstMessage =
        firstField !== undefined ? fieldErrors[firstField]?.[0] : undefined;
      const message =
        firstField && firstMessage
          ? `${firstField}: ${firstMessage}`
          : 'Datos inválidos. Revisa los campos.';
      setError(message);
      return;
    }

    startTransition(async () => {
      const result = initial
        ? await updateBrandVoiceAction(null, {
            brandVoiceId: initial.id,
            form: parsed.data,
          })
        : await createBrandVoiceAction(null, {
            brandId,
            form: parsed.data,
          });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push('/settings/brand-voice');
    });
  };

  const toggleLanguage = (code: 'es' | 'en' | 'pt' | 'fr'): void => {
    setLanguages((prev) =>
      prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code],
    );
  };

  const togglePlatform = (p: PlatformCode): void => {
    setRequirePlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const toggleGoal = (g: CampaignGoal): void => {
    setRequireGoals((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  };

  return (
    <form
      onSubmit={onSubmit}
      className="grid max-w-3xl grid-cols-1 gap-6 rounded-lg border bg-card/30 p-4"
    >
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Identidad</h2>
        <div className="flex flex-col gap-1">
          <Label htmlFor="voice-name">Nombre del perfil</Label>
          <Input
            id="voice-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            maxLength={100}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="voice-tone">Tono</Label>
          <Input
            id="voice-tone"
            value={tone}
            onChange={(e) => setTone(e.currentTarget.value)}
            placeholder="ej. cordial, profesional, cálido"
            maxLength={200}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="voice-style">Estilo</Label>
          <textarea
            id="voice-style"
            value={style}
            onChange={(e) => setStyle(e.currentTarget.value)}
            placeholder="Describe el estilo: ritmo, vocabulario, longitud típica, etc."
            maxLength={500}
            required
            className="min-h-[80px] resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Vocabulario</h2>
        <div className="flex flex-col gap-1">
          <Label htmlFor="voice-forbidden">Palabras prohibidas (CSV)</Label>
          <textarea
            id="voice-forbidden"
            value={forbidden}
            onChange={(e) => setForbidden(e.currentTarget.value)}
            placeholder="garantizado, milagroso, mejor del mundo"
            className="min-h-[60px] resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none"
          />
          <p className="text-[11px] text-muted-foreground">
            Máximo 100 entradas. Lowercase y dedup automático al guardar.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="voice-preferred">Palabras preferidas (CSV)</Label>
          <textarea
            id="voice-preferred"
            value={preferred}
            onChange={(e) => setPreferred(e.currentTarget.value)}
            placeholder="experiencia, comunidad, cuidado"
            className="min-h-[60px] resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="voice-emojis">Emojis permitidos (CSV)</Label>
          <textarea
            id="voice-emojis"
            value={emojis}
            onChange={(e) => setEmojis(e.currentTarget.value)}
            placeholder="✨, 🌟, ❤️"
            className="min-h-[40px] resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none"
          />
          <p className="text-[11px] text-muted-foreground">
            Máximo 50. Cada entrada debe empezar con un emoji válido (máximo
            4 caracteres incluyendo modificadores).
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Idiomas</h2>
        <div className="flex flex-wrap gap-2">
          {ALL_LANGUAGES.map((l) => {
            const active = languages.includes(l.code);
            return (
              <button
                type="button"
                key={l.code}
                onClick={() => toggleLanguage(l.code)}
                className={
                  active
                    ? 'rounded-md border border-foreground bg-foreground px-3 py-1.5 text-xs text-background'
                    : 'rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-muted'
                }
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Reglas de aprobación</h2>
        <p className="text-xs text-muted-foreground">
          Cualquier regla activa enruta el post a /approvals antes de
          publicarse. Combinables.
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requireAll}
            onChange={(e) => setRequireAll(e.currentTarget.checked)}
          />
          <span>Requerir aprobación para TODOS los posts de esta marca</span>
        </label>

        <div className="flex flex-col gap-2">
          <Label>Requerir aprobación cuando la plataforma destino esté en:</Label>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.filter((p) => p !== 'mock').map((p) => {
              const active = requirePlatforms.includes(p);
              return (
                <button
                  type="button"
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={
                    active
                      ? 'rounded-md border border-amber-500 bg-amber-100 px-2.5 py-1 text-[11px] uppercase tracking-wide text-amber-900 dark:bg-amber-950/60 dark:text-amber-100'
                      : 'rounded-md border bg-background px-2.5 py-1 text-[11px] uppercase tracking-wide hover:bg-muted'
                  }
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Requerir aprobación cuando el goal de la campaña sea:</Label>
          <div className="flex flex-wrap gap-2">
            {CAMPAIGN_GOALS.map((g) => {
              const active = requireGoals.includes(g);
              return (
                <button
                  type="button"
                  key={g}
                  onClick={() => toggleGoal(g)}
                  className={
                    active
                      ? 'rounded-md border border-amber-500 bg-amber-100 px-2.5 py-1 text-[11px] uppercase tracking-wide text-amber-900 dark:bg-amber-950/60 dark:text-amber-100'
                      : 'rounded-md border bg-background px-2.5 py-1 text-[11px] uppercase tracking-wide hover:bg-muted'
                  }
                >
                  {g}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {error ? (
        <p
          className="inline-flex items-center gap-1 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle className="h-3 w-3" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || languages.length === 0}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          {initial ? 'Guardar cambios' : 'Crear voz'}
        </Button>
      </div>
    </form>
  );
}
