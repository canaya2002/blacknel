import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function LandingPage(): React.ReactElement {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-6 py-24">
      <div className="rounded-full border bg-muted/40 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
        Phase 1 preview
      </div>
      <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
        Centraliza redes sociales, reseñas, mensajes y reputación en una sola plataforma.
      </h1>
      <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
        Blacknel reúne tu inbox unificado, programación de publicaciones, gestión de
        reseñas, IA con guardrails y reportes ejecutivos en un solo lugar. Pensado para
        equipos de marketing, atención al cliente y operaciones que manejan varias marcas
        o ubicaciones desde un panel web.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link href="/login">Probar la demo</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/pricing">Ver precios</Link>
        </Button>
      </div>
    </section>
  );
}
