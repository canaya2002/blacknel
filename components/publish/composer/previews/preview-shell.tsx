import { Eye } from 'lucide-react';

import { PreviewFacebook } from './preview-facebook';
import { PreviewGBP } from './preview-gbp';
import { PreviewGeneric } from './preview-generic';
import { PreviewInstagram } from './preview-instagram';
import { PreviewLinkedIn } from './preview-linkedin';
import type { PreviewSlice } from './preview-shared';

interface PreviewShellProps {
  slices: ReadonlyArray<PreviewSlice>;
}

/**
 * Orchestrator for the composer preview column. Receives an array
 * of pre-computed `PreviewSlice` objects from the shell and
 * dispatches each to the matching fiel component. Anything not in
 * the fiel allow-list (Facebook, Instagram, GBP, LinkedIn — added
 * in Commit 21) falls through to `<PreviewGeneric />`.
 *
 * Remaining platforms on the generic path (Phase 12 polish):
 *
 *   - x          — rate limits / policy churn means Phase-11
 *                  connector cutover is the right time to validate.
 *   - tiktok     — visual-heavy; needs more asset variety to
 *                  justify the fidelity.
 *   - pinterest  — same as tiktok.
 *   - youtube    — preview value is low for a 60s short, high for
 *                  the long-form embed. Decide post-connector.
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
    case 'linkedin':
      return <PreviewLinkedIn slice={slice} />;
    default:
      return <PreviewGeneric slice={slice} />;
  }
}
