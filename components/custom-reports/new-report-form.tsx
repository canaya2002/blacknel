'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

import { createCustomReportAction } from '@/app/(app)/reports/custom/actions';
import type { TemplateId } from '@/lib/custom-reports/templates';

interface NewCustomReportFormProps {
  templateId: TemplateId | null;
}

export function NewCustomReportForm({
  templateId,
}: NewCustomReportFormProps): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState(
    templateId === 'marketing_performance'
      ? 'Marketing Performance · ' + new Date().toLocaleDateString()
      : templateId === 'customer_service_overview'
        ? 'Customer Service Overview · ' + new Date().toLocaleDateString()
        : templateId === 'executive_dashboard'
          ? 'Executive Dashboard · ' + new Date().toLocaleDateString()
          : '',
  );
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    if (name.trim().length === 0) {
      setError('El nombre es requerido.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createCustomReportAction(null, {
        name: name.trim(),
        description: description.trim() || null,
        templateId,
      });
      if (result.ok) {
        router.push(`/reports/custom/${result.data.reportId}/edit`);
      } else {
        setError(result.error.message);
      }
    });
  };

  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Nombre del reporte</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Marketing Performance · Q1"
            data-testid="new-report-name"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Descripción (opcional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            placeholder="Vista executive de los KPIs clave del trimestre."
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        {templateId ? (
          <div className="rounded-md border bg-card/40 p-3 text-[11px] text-muted-foreground">
            Template <strong>{templateId.replace(/_/g, ' ')}</strong> seleccionado.
            Los widgets se materializan al crear el reporte.
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-card/30 p-3 text-[11px] text-muted-foreground">
            Reporte en blanco. Agregás widgets desde el builder.
          </div>
        )}
        {error ? (
          <span className="text-xs text-destructive" data-testid="new-report-error">
            {error}
          </span>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            onClick={submit}
            disabled={pending}
            data-testid="new-report-submit"
          >
            {pending ? 'Creando…' : 'Crear reporte'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
