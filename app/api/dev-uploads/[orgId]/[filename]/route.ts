import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/lib/auth/server';
import { getStorageProvider } from '@/lib/storage';
import { DevFilesystemProvider } from '@/lib/storage/dev-filesystem-provider';
import { log } from '@/lib/log';

/**
 * GET /api/dev-uploads/[orgId]/[filename]
 *
 * Serves an asset blob from the dev-mode filesystem provider.
 *
 * # Auth + tenancy (defense in depth)
 *
 *   - **Not signed in →** `401`. Standard challenge.
 *   - **Path `orgId` ≠ session.orgId →** `404`. We intentionally
 *     do NOT distinguish "wrong org" from "missing file" so a
 *     curious user with another org's key can't probe for asset
 *     existence by URL guessing.
 *   - **Key fails the provider's traversal guards →** `404` for
 *     the same reason.
 *   - **File missing on disk →** `404`.
 *
 * # Content-Type
 *
 * Derived from the filename extension (the provider already
 * whitelists extensions on upload — see
 * `ALLOWED_EXTENSIONS`). Anything outside the whitelist is
 * served as `application/octet-stream` so a bad extension
 * doesn't get rendered inline.
 *
 * # Phase 11
 *
 * This route is dev-only — the Phase 11 `SupabaseStorageProvider`
 * issues signed CDN URLs and the asset blob never touches our
 * server. Keeping the route handler isolated to a single file
 * makes the swap a one-line conditional in `lib/storage/index.ts`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILENAME_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-z0-9]{2,5}$/;

const paramsSchema = z.object({
  orgId: z.string().regex(UUID_RE),
  filename: z.string().regex(FILENAME_RE),
});

const CONTENT_TYPE_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};

interface RouteParams {
  params: Promise<{ orgId: string; filename: string }>;
}

export async function GET(
  _request: Request,
  context: RouteParams,
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new NextResponse('Sign in required.', { status: 401 });
  }

  const rawParams = await context.params;
  const parsed = paramsSchema.safeParse(rawParams);
  if (!parsed.success) {
    // Malformed UUID / filename — same 404 we use for cross-org.
    log.warn(
      { params: rawParams, issues: parsed.error.flatten() },
      'dev-uploads.bad_params',
    );
    return notFound();
  }
  const { orgId, filename } = parsed.data;

  if (orgId !== session.orgId) {
    log.warn(
      { pathOrgId: orgId, sessionOrgId: session.orgId, userId: session.userId },
      'dev-uploads.cross_tenant_blocked',
    );
    return notFound();
  }

  const provider = getStorageProvider();
  if (!(provider instanceof DevFilesystemProvider)) {
    // Phase 11 cutover should have routed this differently. Fail
    // closed if somehow invoked under a non-dev provider.
    log.error('dev-uploads.invoked_under_non_dev_provider');
    return notFound();
  }

  const key = `${orgId}/${filename}`;
  const buffer = await provider.read(key);
  if (!buffer) {
    return notFound();
  }

  const ext = extensionOf(filename);
  const contentType = CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      // Short cache — the URL is org-scoped + key is UUID, so
      // collisions are essentially zero; the cache mostly helps
      // with re-renders of the composer preview during editing.
      'Cache-Control': 'private, max-age=60',
    },
  });
}

function notFound(): Response {
  return new NextResponse('Not found.', { status: 404 });
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.slice(idx).toLowerCase();
}
