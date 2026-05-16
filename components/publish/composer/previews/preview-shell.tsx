import { Eye } from 'lucide-react';

import { PreviewFacebook } from './preview-facebook';
import { PreviewGBP } from './preview-gbp';
import { PreviewGeneric } from './preview-generic';
import { PreviewInstagram } from './preview-instagram';
import type { PreviewSlice } from './preview-shared';

interface PreviewShellProps {
  slices: ReadonlyArray<PreviewSlice>;
}

/**
 * Orchestrator for the composer preview column. Receives an array
 * of pre-computed `PreviewSlice` objects from the shell and
 * dispatches each to the matching fiel component. Anything not in
 * the fiel allow-list (Facebook, Instagram, GBP) falls through to
 * `<PreviewGeneric />` — the Commit 21 polish pass replaces those
 * one-by-one without touching this dispatch.
 *
 * Stack scrolls independently when there are >3 previews (max
 * viewport-height with overflow-y).
 */
export function PreviewShell({ slices }: PreviewShellProps): React.ReactElement {
  if (slices.length === 0) {
    return (
      <section className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card/30 p-8 text-center">
        <Eye className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Sin cuentas seleccionadas</p>
        <p className="text-xs text-muted-foreground">
          Selecciona cuentas destino en el bloque &ldquo;Cuentas destino&rdquo;
          a la izquierda y verás aquí una vista previa por cada red.
        </p>
      </section>
    );
  }

  return (
    <section className="flex max-h-[calc(100vh-12rem)] flex-col gap-3 overflow-y-auto pr-1">
      <header className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Previews ({slices.length})
      </header>
      {slices.map((slice) => (
        <PreviewForPlatform key={slice.key} slice={slice} />
      ))}
    </section>
  );
}

function PreviewForPlatform({ slice }: { slice: PreviewSlice }): React.ReactElement {
  switch (slice.platform) {
    case 'facebook':
      return <PreviewFacebook slice={slice} />;
    case 'instagram':
      return <PreviewInstagram slice={slice} />;
    case 'gbp':
      return <PreviewGBP slice={slice} />;
    default:
      return <PreviewGeneric slice={slice} />;
  }
}
