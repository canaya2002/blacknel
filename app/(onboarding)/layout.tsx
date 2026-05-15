import Link from 'next/link';

import { logoutAction } from '../(app)/actions';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-16 items-center border-b px-6">
        <Link
          href="/onboarding/start"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="text-sm font-bold">B</span>
          </div>
          Blacknel
        </Link>
        <form action={logoutAction} className="ml-auto">
          <Button type="submit" variant="ghost" size="sm">
            Salir
          </Button>
        </form>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
