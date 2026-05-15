'use client';

import { Check } from 'lucide-react';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { finishOnboardingAction } from './actions';

export function StepWelcome(): React.ReactElement {
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
          <Check className="h-6 w-6" aria-hidden />
        </div>
        <CardTitle>¡Listo!</CardTitle>
        <CardDescription>
          Tu workspace está armado. El dashboard incluye un checklist persistente con
          los siguientes pasos: conectar redes, agregar más ubicaciones, invitar al
          resto del equipo y crear tu primer post.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button
          onClick={() => start(() => finishOnboardingAction())}
          disabled={pending}
        >
          {pending ? 'Llevándote al dashboard…' : 'Entrar al dashboard'}
        </Button>
      </CardContent>
    </Card>
  );
}
