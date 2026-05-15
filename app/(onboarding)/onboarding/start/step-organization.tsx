'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { submitOrganizationAction } from './actions';

export function StepOrganization(): React.ReactElement {
  const [state, action, pending] = useActionState<
    { error?: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await submitOrganizationAction(_prev, formData);
    return result.ok ? null : { error: result.error.message };
  }, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cuéntanos de tu negocio</CardTitle>
        <CardDescription>
          Una organización agrupa todo tu trabajo en Blacknel — marcas, ubicaciones,
          equipo, integraciones. Empezamos por lo básico.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-name">Nombre del negocio</Label>
            <Input
              id="org-name"
              name="name"
              required
              autoFocus
              placeholder="Tacos del Centro, S.A."
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-country" className="text-xs">
                País
              </Label>
              <Input
                id="org-country"
                name="country"
                defaultValue="MX"
                maxLength={2}
                placeholder="MX"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-locale" className="text-xs">
                Idioma
              </Label>
              <Input
                id="org-locale"
                name="locale"
                defaultValue="es"
                placeholder="es"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-timezone" className="text-xs">
                Zona horaria
              </Label>
              <Input
                id="org-timezone"
                name="timezone"
                defaultValue="America/Mexico_City"
                placeholder="UTC"
              />
            </div>
          </div>
          {state?.error ? (
            <p className="text-xs text-destructive">{state.error}</p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Creando…' : 'Continuar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
