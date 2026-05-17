'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { exportOverviewCsvAction } from '@/app/(app)/reports/export-action';
import { Button } from '@/components/ui/button';
import type { ReportPeriod } from '@/lib/reports/period';

interface ReportExportButtonProps {
  period: ReportPeriod;
  brandId: string | null;
}

/**
 * Triggers the Overview CSV export Server Action (Commit 27,
 * D-27-3 + Ajuste 3). The action returns the CSV body inline;
 * we wrap it in a data URI and synthesize a click on a hidden
 * `<a download>`.
 *
 * No Blob URL here — keeps the SSR-friendly Server-Component
 * surface intact; if we wanted streaming or large rows, the
 * Phase-12 polish swaps to a fetch-streaming endpoint.
 */
export function ReportExportButton({
  period,
  brandId,
}: ReportExportButtonProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await exportOverviewCsvAction(null, {
        section: 'overview',
        period,
        brandId,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const dataUri =
        'data:text/csv;charset=utf-8,' + encodeURIComponent(result.data.csv);
      const a = document.createElement('a');
      a.href = dataUri;
      a.download = result.data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={onClick}
        disabled={pending}
        data-testid="reports-export-overview"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden />
        )}
        Export CSV
      </Button>
      {error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : null}
    </div>
  );
}
