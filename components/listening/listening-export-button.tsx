'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { exportListeningMentionsCsvAction } from '@/app/(app)/listening/actions';
import { Button } from '@/components/ui/button';

interface ListeningExportButtonProps {
  period: '7d' | '30d' | '90d';
  status: 'new' | 'triaged' | 'archived' | 'converted' | 'all';
  brandId: string | null;
}

/**
 * Listening mentions CSV export (Phase 9 / Commit 33 · Ajuste A).
 *
 * Mirrors `components/reports/ads-export-button.tsx`. Audit row
 * uses `section: 'listening'` with the period + status + brand
 * filters bundled into the `filters` metadata.
 */
export function ListeningExportButton({
  period,
  status,
  brandId,
}: ListeningExportButtonProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await exportListeningMentionsCsvAction(null, {
        period,
        status,
        brandId,
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
        data-testid="listening-export-csv"
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
