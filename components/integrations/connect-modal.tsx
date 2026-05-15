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
import type { PlatformCode } from '@/lib/connectors/base';

import { connectAccountAction } from '../../app/(app)/integrations/actions';

const PRETTY: Record<PlatformCode, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  gbp: 'Google Business Profile',
  whatsapp: 'WhatsApp Business',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
  yelp: 'Yelp',
  tripadvisor: 'TripAdvisor',
  trustpilot: 'Trustpilot',
  bbb: 'BBB',
  avvo: 'Avvo',
  mock: 'Mock connector',
};

interface ConnectButtonProps {
  platform: PlatformCode;
}

export function ConnectButton({ platform }: ConnectButtonProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlugZap className="h-3.5 w-3.5" />
        Conectar
      </Button>
      {open ? (
        <ConnectDialog
          platform={platform}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}

function ConnectDialog({
  platform,
  open,
  onOpenChange,
}: {
  platform: PlatformCode;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}): React.ReactElement {
  const [state, action, pending] = useActionState<
    { ok?: boolean; error?: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await connectAccountAction(_prev, formData);
    if (result.ok) {
      onOpenChange(false);
      return { ok: true };
    }
    return { error: result.error.message };
  }, null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar {PRETTY[platform]}</DialogTitle>
          <DialogDescription>
            Te redirigiremos a {PRETTY[platform]} para autorizar Blacknel. En modo dev
            simulamos el OAuth y vuelves con la cuenta enlazada en unos segundos —
            APIs reales se cablean en la Fase 11.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="platform" value={platform} />
          {pending ? (
            <div className="flex items-center gap-3 rounded-md border bg-card/40 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Estableciendo conexión con {PRETTY[platform]}…
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Autorizaremos los scopes necesarios para las capacidades que esta
              plataforma soporta. Puedes asignarla a una marca / ubicación después
              en el detalle.
            </p>
          )}
          {state?.error ? (
            <p className="text-xs text-destructive">{state.error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Conectando…' : `Autorizar ${PRETTY[platform]}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
