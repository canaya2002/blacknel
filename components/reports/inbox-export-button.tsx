'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { exportInboxCsvAction } from '@/app/(app)/reports/inbox-export-action';
import { Button } from '@/components/ui/button';
import type { ReportPeriod } from '@/lib/reports/period';

interface InboxExportButtonProps {
  period: ReportPeriod;
  brandId: string | null;
}

export function InboxExportButton({
  period,
  brandId,
}: InboxExportButtonProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await exportInboxCsvAction(null, {
        section: 'inbox',
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
        data-testid="reports-export-inbox"
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
