import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isLocalDiskStorage, readLocalDocument } from '@/lib/storage/private-storage';

/**
 * Development-only document viewer for the admin verification queue.
 *
 * In production documents are served by Supabase through short-lived signed
 * URLs and this route answers 404. Locally there is no signed URL to hand out,
 * so an admin fetches the document by its database id — never by storage key —
 * and gets the bytes back with no caching.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' || !isLocalDiskStorage()) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    await requireAdmin();
  } catch {
    return new NextResponse(null, { status: 403 });
  }

  const { id } = await params;
  const document = await prisma.verificationDocument.findUnique({
    where: { id },
    select: { storageKey: true, mimeType: true },
  });
  if (!document) return new NextResponse(null, { status: 404 });

  const body = await readLocalDocument(document.storageKey);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
