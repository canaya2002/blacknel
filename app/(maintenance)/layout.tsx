/**
 * Phase 11 / Commit 40 — minimal maintenance layout.
 *
 * No auth check, no DB hit, no shared shell. The maintenance page
 * exists precisely so that when DB or Auth is broken, the user
 * still gets a real response. Keep this layout self-contained.
 */
export default function MaintenanceLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="es">
      <body className="min-h-screen bg-zinc-50 antialiased dark:bg-zinc-950">
        {children}
      </body>
    </html>
  );
}
