'use client';

import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { submitConnectSkipAction } from './actions';

export function StepConnect(): React.ReactElement {
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conecta tu primera red</CardTitle>
        <CardDescription>
          Lo haremos en el siguiente paso de tu configuración. Por ahora avanza —
          en el dashboard verás un checklist que te guía a Facebook, Instagram y
          Google Business Profile cuando el Integrations Center aterrice (Fase 3).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          onClick={() => start(() => submitConnectSkipAction())}
          disabled={pending}
        >
          {pending ? 'Avanzando…' : 'Saltar por ahora'}
        </Button>
      </CardContent>
    </Card>
  );
}
