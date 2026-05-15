'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { submitLocationAction } from './actions';

export function StepLocation(): React.ReactElement {
  const [state, action, pending] = useActionState<
    { error?: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await submitLocationAction(_prev, formData);
    return result.ok ? null : { error: result.error.message };
  }, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tu primera ubicación</CardTitle>
        <CardDescription>
          Sirve para agrupar reseñas, Google Business Profile y métricas por sucursal.
          La zona horaria se hereda de la organización.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="loc-name">Nombre</Label>
            <Input id="loc-name" name="name" required autoFocus placeholder="Centro" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="loc-city" className="text-xs">
                Ciudad
              </Label>
              <Input id="loc-city" name="city" placeholder="Ciudad de México" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="loc-country" className="text-xs">
                País
              </Label>
              <Input id="loc-country" name="country" maxLength={2} placeholder="MX" />
            </div>
          </div>
          {state?.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Guardando…' : 'Continuar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
