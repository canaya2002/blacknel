'use client';

import { Loader2, Send } from 'lucide-react';
import { useMemo, useState } from 'react';

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
import type { WhatsappTemplateForComposer } from './composer';

interface WhatsappTemplatePickerProps {
  templates: ReadonlyArray<WhatsappTemplateForComposer>;
  onSend: (
    template: WhatsappTemplateForComposer,
    variables: Record<string, string>,
  ) => void;
  pending: boolean;
}

/**
 * WhatsApp template picker for the composer (Phase 9 / Commit 31).
 *
 * Visible only when the parent passes one or more `templates`
 * (composer asks for approved templates of the WABA bound to
 * the thread). Picking a template renders one form field per
 * declared variable; the "Enviar template" CTA forwards the
 * `(template, variables)` pair to the parent's
 * `sendTemplateAction` wrapper.
 *
 * The body preview shows the raw Meta-format with `{{1}}`
 * placeholders so the user verifies what's about to ship.
 */
export function WhatsappTemplatePicker({
  templates,
  onSend,
  pending,
}: WhatsappTemplatePickerProps): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | ''>('');
  const [values, setValues] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const canSend =
    selected !== null &&
    selected.variables.every((v) => (values[v.label] ?? '').trim().length > 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="wa-template" className="text-xs uppercase tracking-wide text-muted-foreground">
          Enviar como template
        </Label>
        <Select
          value={selectedId}
          onValueChange={(v) => {
            setSelectedId(v);
            setValues({});
          }}
        >
          <SelectTrigger id="wa-template" className="w-72">
            <SelectValue placeholder="Elegí un template approved" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} · {t.language}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {selected ? (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
          <p className="whitespace-pre-wrap font-mono text-xs">
            {selected.body}
          </p>
          {selected.variables.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {selected.variables.map((v) => (
                <div key={v.label} className="flex flex-col gap-1">
                  <Label
                    htmlFor={`wa-var-${v.label}`}
                    className="text-xs"
                  >
                    {`{{${v.position}}} ${v.label}`}
                  </Label>
                  <Input
                    id={`wa-var-${v.label}`}
                    value={values[v.label] ?? ''}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [v.label]: e.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!canSend || pending}
              onClick={() => {
                if (selected) onSend(selected, values);
              }}
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Enviar template
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
