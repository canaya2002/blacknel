'use client';

import { Loader2, Plus } from 'lucide-react';
import { useState, useTransition } from 'react';

import { createTemplateAction } from '@/app/(app)/integrations/whatsapp/actions';
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

interface NewTemplateDialogProps {
  whatsappAccountId: string;
}

/**
 * Create-template dialog. Submits via `createTemplateAction`
 * which calls the mock Meta-review verdict synchronously
 * (D-31-2 Opción A — full lifecycle). The result.status tells
 * us whether to show success ("approved") or error
 * ("rejected: <reason>").
 */
export function NewTemplateDialog({
  whatsappAccountId,
}: NewTemplateDialogProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] =
    useState<'utility' | 'marketing' | 'authentication'>('utility');
  const [language, setLanguage] = useState('es');
  const [body, setBody] = useState('');

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await createTemplateAction(null, {
        whatsappAccountId,
        name: name.trim(),
        category,
        language: language.trim(),
        body: body.trim(),
        variables: [],
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (result.data.status === 'rejected') {
        setError(
          'El template fue rechazado por Meta. Revisá el listado para ver la razón.',
        );
        return;
      }
      setOpen(false);
      setName('');
      setBody('');
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        Nuevo template
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo template WhatsApp</DialogTitle>
            <DialogDescription>
              Meta revisa cada template antes de aprobarlo. En este entorno
              mock, los templates se aprueban automáticamente salvo que el
              cuerpo contenga la palabra <code>FORBIDDEN</code> (testing hook).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Nombre (a-z, 0-9, _)</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="appointment_reminder"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category">Categoría</Label>
              <Select
                value={category}
                onValueChange={(v) =>
                  setCategory(v as 'utility' | 'marketing' | 'authentication')
                }
              >
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utility">Utility</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="authentication">Authentication</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="language">Idioma (es, en, es_MX, ...)</Label>
              <Input
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="es"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="body">Cuerpo</Label>
              <textarea
                id="body"
                className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm font-mono shadow-sm"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Hola {{1}}, tu pedido {{2}} ya está en camino."
                rows={5}
              />
            </div>
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={pending || !name.trim() || !body.trim()}
              onClick={submit}
            >
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Submitiendo…
                </>
              ) : (
                'Submit a Meta'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
