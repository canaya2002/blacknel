import { getKillSwitchState } from '@/lib/kill-switch/check';

/**
 * Phase 11 / Commit 40 — maintenance landing page.
 *
 * Served with HTTP 200 (the middleware that bounces users here
 * already issued the 503 from the original route). The page is
 * the user-friendly view of the kill switch state — it must NOT
 * depend on DB or Auth.
 *
 * Future: link to `status.blacknel.app` (status indicator) once
 * Phase 12 ships statuspage. For now the support email is the
 * only escalation path.
 */
export default function MaintenancePage(): React.ReactElement {
  const state = getKillSwitchState();
  const readOnly = state === 'read-only';

  return (
    <main
      className="flex min-h-screen items-center justify-center px-6"
      data-testid="maintenance-page"
    >
      <div className="max-w-md space-y-4 text-center">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300"
          aria-hidden
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold">
          {readOnly
            ? 'Modo lectura temporal'
            : 'Estamos en mantenimiento'}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {readOnly
            ? 'Operaciones de escritura están temporalmente deshabilitadas mientras corremos una ventana de mantenimiento. Las lecturas siguen disponibles. Volvé a intentar en unos minutos.'
            : 'Estamos aplicando un cambio operacional. El servicio vuelve en unos minutos. Si la situación se extiende, podés escribirnos.'}
        </p>
        <p className="pt-4 text-xs text-zinc-500">
          ¿Algo urgente? Escribinos a{' '}
          <a
            href="mailto:support@blacknel.app"
            className="font-medium text-zinc-700 underline dark:text-zinc-300"
          >
            support@blacknel.app
          </a>
        </p>
      </div>
    </main>
  );
}
