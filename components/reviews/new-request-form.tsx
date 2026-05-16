'use client';

import { Loader2, Send } from 'lucide-react';
import { useState, useTransition } from 'react';

import { createReviewRequestAction } from '@/app/(app)/reviews/requests/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface NewRequestFormProps {
  /** Pre-seeded `(brandId, locationId)` pairs for the location picker. */
  locations: ReadonlyArray<{
    brandId: string;
    locationId: string;
    label: string;
  }>;
}

/**
 * Minimal single-recipient form. Bulk paste lands as a follow-up in
 * Phase 12 (CSV upload is part of the Enterprise tier per the
 * master prompt § 1.6). For now: one email, one name, one location.
 *
 * Error handling surfaces every named error code the orchestrator
 * may return — DUPLICATE_REVIEW_REQUEST is the most common case in
 * normal usage so the copy is friendly.
 */
export function NewRequestForm({
  locations,
}: NewRequestFormProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [locationKey, setLocationKey] = useState(
    locations[0] ? `${locations[0].brandId}::${locations[0].locationId}` : '',
  );

  const submit = (): void => {
    if (!email.trim() || !locationKey) return;
    const [brandId, locationId] = locationKey.split('::');
    if (!brandId || !locationId) {
      setError('Selecciona una ubicación válida.');
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await createReviewRequestAction(null, {
        brandId,
        locationId,
        email: email.trim(),
        ...(name.trim().length > 0 ? { name: name.trim() } : {}),
      });
      if (result.ok) {
        setSuccess('Solicitud enviada. El destinatario verá el email en su bandeja.');
        setEmail('');
        setName('');
      } else if (result.error.code === 'DUPLICATE_REVIEW_REQUEST') {
        setError(
          'Ya enviaste una solicitud a este email en los últimos 30 días. Espera el resto del período antes de reenviar.',
        );
      } else if (result.error.code === 'PLAN_LIMIT_REACHED') {
        setError(
          'Alcanzaste el cupo mensual de solicitudes de reseña para tu plan.',
        );
      } else {
        setError(result.error.message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Send className="h-4 w-4" aria-hidden /> Nueva solicitud
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="rq-email" className="text-[10px] uppercase tracking-wide">
            Email
          </Label>
          <Input
            id="rq-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cliente@ejemplo.com"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rq-name" className="text-[10px] uppercase tracking-wide">
            Nombre (opcional)
          </Label>
          <Input
            id="rq-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ana"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide">Ubicación</Label>
          <Select value={locationKey} onValueChange={setLocationKey}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecciona…" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem
                  key={`${l.brandId}::${l.locationId}`}
                  value={`${l.brandId}::${l.locationId}`}
                  className="text-xs"
                >
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : success ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">{success}</span>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            Se envía por email. Token único 30d. Mismo email + ubicación: dedup
            automático.
          </span>
        )}
        <Button size="sm" onClick={submit} disabled={pending || !email.trim()}>
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Enviar
        </Button>
      </div>
    </div>
  );
}
