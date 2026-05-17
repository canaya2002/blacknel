'use client';

import { Loader2, PlugZap } from 'lucide-react';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { connectAdsAccountAction } from '@/app/(app)/ads/actions';
import { FX_RATES_TO_USD } from '@/lib/ads/fx-rates';
import type { BrandOption } from '@/lib/publish/picker-data';

interface AdsConnectDialogProps {
  brandOptions: ReadonlyArray<BrandOption>;
}

const SUPPORTED_CURRENCIES = Object.keys(FX_RATES_TO_USD);

/**
 * Manual connect dialog (D-28-3). Phase 8 placeholder until
 * Phase 11 wires OAuth for Google Ads and Meta Marketing.
 *
 * Admin+ enters platform + external account id + currency. The
 * action upserts an `ads_accounts` row in `status='connected'`;
 * the sync cron picks it up on its next tick (or you can wait
 * 24h — there's no manual "sync now" yet).
 */
export function AdsConnectDialog({
  brandOptions,
}: AdsConnectDialogProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<'google' | 'meta'>('google');
  const [externalId, setExternalId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [brandId, setBrandId] = useState<string>('');

  const [state, action, pending] = useActionState<
    { ok?: boolean; error?: string } | null,
    FormData
  >(async () => {
    const result = await connectAdsAccountAction(null, {
      platform,
      externalAccountId: externalId.trim(),
      accountName: accountName.trim() || null,
      currency,
      brandId: brandId || null,
    });
    if (result.ok) {
      setOpen(false);
      setExternalId('');
      setAccountName('');
      return { ok: true };
    }
    return { error: result.error.message };
  }, null);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlugZap className="h-3.5 w-3.5" />
        Conectar cuenta
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar cuenta de Ads</DialogTitle>
            <DialogDescription>
              Conexión manual hasta la Fase 11 (OAuth real). El cron
              sincronizará el spend de los últimos 2 días en el próximo
              tick.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="platform">Plataforma</Label>
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as 'google' | 'meta')}
              >
                <SelectTrigger id="platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="google">Google Ads</SelectItem>
                  <SelectItem value="meta">Meta Ads</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="externalAccountId">
                External Account ID
              </Label>
              <Input
                id="externalAccountId"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder={platform === 'google' ? '123-456-7890' : 'act_12345678'}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="accountName">Nombre (opcional)</Label>
              <Input
                id="accountName"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Brand X — Meta"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {brandOptions.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="brand">Marca (opcional)</Label>
                <Select
                  value={brandId}
                  onValueChange={(v) => setBrandId(v === '__none' ? '' : v)}
                >
                  <SelectTrigger id="brand">
                    <SelectValue placeholder="Sin marca asignada" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Sin marca asignada</SelectItem>
                    {brandOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {state?.error ? (
              <p className="text-xs text-destructive">{state.error}</p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || !externalId.trim()}>
                {pending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Conectando…
                  </>
                ) : (
                  'Conectar'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
