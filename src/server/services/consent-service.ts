import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { LEGAL_VERSION, type LegalSlug } from '@/content/legal/documents';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Records that a user accepted the current version of a legal text.
 *
 * Accepts a transaction client so the consent commits (or rolls back) together
 * with the thing it was given for — a coach application, a checkout. The IP is
 * stored only as a hash prefix: enough to tell two sessions apart in a dispute,
 * not enough to identify anyone.
 */
export async function recordConsent(
  args: { userId: string; document: LegalSlug; context?: string; ip?: string | null },
  db: Db = prisma,
): Promise<void> {
  await db.legalConsent.create({
    data: {
      userId: args.userId,
      document: args.document,
      version: LEGAL_VERSION,
      context: args.context ?? null,
      ipHash: args.ip ? createHash('sha256').update(args.ip).digest('hex').slice(0, 32) : null,
    },
  });
}
