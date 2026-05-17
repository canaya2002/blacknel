'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { exportNpsResponsesCsvAction } from '@/app/(app)/nps/actions';
import { Button } from '@/components/ui/button';

interface NpsExportButtonProps {
  period: '7d' | '30d' | '90d';
  surveyId: string | null;
}

/**
 * NPS responses CSV export trigger (Phase 9 / Commit 32 · Ajuste A).
 *
 * Mirrors `components/reports/ads-export-button.tsx` but targets the
 * NPS export action. Audit row carries `section: 'nps'`.
 */
export function NpsExportButton({
  period,
  surveyId,
}: NpsExportButtonProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await exportNpsResponsesCsvAction(null, {
        period,
        surveyId,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const dataUri =
        'data:text/csv;charset=utf-8,' +
        encodeURIComponent(result.data.csv);
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
        data-testid="nps-export-csv"
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
