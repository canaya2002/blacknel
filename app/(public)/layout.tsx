import type { Metadata } from 'next';

/**
 * Public layout for the feedback landing (and any future public
 * surface — NPS landings, unsubscribe pages, etc.). NO Blacknel
 * sidebar, NO app shell, NO `/login` chrome.
 *
 * The customer reaching `/feedback/[token]` knows nothing about
 * Blacknel — they came from the brand's email. The layout is
 * intentionally minimal so the brand owns the visual real estate.
 * A tiny footer credit ("Powered by Blacknel") sits at the bottom
 * for whenever we decide to ship the free tier with branding.
 */

export const metadata: Metadata = {
  title: 'Feedback',
  // No JS-relevant meta. The page-specific metadata can override.
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <main className="flex-1">{children}</main>
      <footer className="border-t px-6 py-3 text-center text-[10px] text-muted-foreground/70">
        Powered by{' '}
        <a
          href="https://blacknel.app"
          className="underline-offset-2 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Blacknel
        </a>
      </footer>
    </div>
  );
}
