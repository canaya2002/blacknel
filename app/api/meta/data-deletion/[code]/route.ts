import 'server-only';

import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { dbAdmin } from '@/lib/db/client';
import { metaDeletionRequests } from '@/lib/db/schema';
import { log } from '@/lib/log';

/**
 * Status lookup for a previously-accepted Meta data-deletion request.
 *
 * The privacy status page (marketing site, `blacknel.com/es/privacy`)
 * loads this via fetch using the `code` query parameter that came back
 * from the POST. PUBLIC — must be in `proxy.ts` PUBLIC_PATHS.
 *
 * 404 when the code is malformed or doesn't match a row. Intentionally
 * thin response — we never expose `signed_request` or `meta_user_id`
 * to the public reader.
 */
export const dynamic = 'force-dynamic';

const codeSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;
  const parsed = codeSchema.safeParse(code);
  if (!parsed.success) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  try {
    const rows = await dbAdmin(async (tx) =>
      tx
        .select({
          status: metaDeletionRequests.status,
          requestedAt: metaDeletionRequests.createdAt,
          processedAt: metaDeletionRequests.processedAt,
        })
        .from(metaDeletionRequests)
        .where(eq(metaDeletionRequests.confirmationCode, parsed.data))
        .limit(1),
    );
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(
      {
        status: row.status,
        requested_at: row.requestedAt.toISOString(),
        processed_at: row.processedAt ? row.processedAt.toISOString() : null,
      },
      { status: 200 },
    );
  } catch (err) {
    log.error({ err }, 'meta.data_deletion.status_lookup_failed');
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
}
