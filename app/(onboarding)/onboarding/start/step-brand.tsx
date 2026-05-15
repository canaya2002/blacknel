'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { submitBrandAction } from './actions';

export function StepBrand(): React.ReactElement {
  const [state, action, pending] = useActionState<
    { error?: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await submitBrandAction(_prev, formData);
    return result.ok ? null : { error: result.error.message };
  }, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tu primera marca</CardTitle>
        <CardDescription>
          Las marcas agrupan canales, voz y posts. Si manejas varios negocios desde una
          sola cuenta, agregarás más después.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-name">Nombre de la marca</Label>
            <Input id="brand-name" name="name" required autoFocus placeholder="Mi Marca" />
          </div>
          {state?.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Creando…' : 'Continuar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
