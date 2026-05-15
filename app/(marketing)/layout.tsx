import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center border-b px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="text-sm font-bold">B</span>
          </div>
          Blacknel
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/pricing">Pricing</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t px-6 py-6 text-xs text-muted-foreground">
        © {new Date().getFullYear()} Blacknel
      </footer>
    </div>
  );
}
