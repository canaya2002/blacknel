import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { ComposerShell } from '@/components/publish/composer/composer-shell';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { loadComposerData } from '@/lib/publish/composer/loader';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface ComposerPageProps {
  params: Promise<{ id: string }>;
}

const idSchema = z.string().uuid();

/**
 * /publish/composer/[id] — Commit 19a.
 *
 * Composer editor for a single post draft. Renders the shell with
 * pre-loaded data; the editor itself is a Client component (see
 * `<ComposerShell />`). Subsequent commits add:
 *
 *   - 19b: media uploader + storage provider + asset library
 *   - 19c: previews (FB / IG / GBP fieles + generic), schedule
 *          control, compliance pill, AI caption stub, approval
 *          rule integration
 *
 * State persistence is currently per-action:
 *   - text / link / utm / campaignId → `saveDraftAction` (idle
 *     auto-save lands in 19c)
 *   - account picker selection       → `setPostTargetsAction`
 *   - schedule transition            → `schedulePostAction` (C18)
 */
export default async function ComposerEditorPage({
  params,
}: ComposerPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const { id } = await params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const [data, planCode] = await Promise.all([
    loadComposerData({
      orgId: session.orgId,
      userId: session.userId,
      postId: parsedId.data,
    }),
    getOrgPlanCode(session),
  ]);
  if (!data) notFound();

  // Posts in terminal or in-flight states are not editable. We
  // render a read-only banner pointing back to the calendar.
  const editable =
    data.postDetail.status === 'draft' ||
    data.postDetail.status === 'pending_approval';

  return (
    <div className="flex flex-col">
      {editable ? (
        <ComposerShell data={data} planCode={planCode} />
      ) : (
        <NonEditableNotice status={data.postDetail.status} />
      )}
    </div>
  );
}

function NonEditableNotice({ status }: { status: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <h2 className="text-lg font-semibold tracking-tight">
        Este post ya no se puede editar
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Estado actual: <span className="font-medium">{status}</span>. Para
        modificar el contenido, cancela el post o duplícalo desde el calendario.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/publish" prefetch={false}>
          Volver al calendario
        </Link>
      </Button>
    </div>
  );
}
