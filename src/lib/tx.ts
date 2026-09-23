import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Concurrency primitives.
 *
 * The governing idea: **every state write is a compare-and-swap against the
 * expected prior state.** The FSM guards in `state-machine.ts` are advisory —
 * they run against a snapshot that may already be stale by the time we write.
 * The CAS is authoritative. If the row moved under us, the update matches zero
 * rows and we fail loudly instead of applying a transition computed from a
 * state that no longer exists.
 *
 * This is why the money paths do not need SERIALIZABLE isolation for the common
 * case: a lost update is impossible when the WHERE clause names the prior state,
 * and READ COMMITTED re-evaluates the predicate on a blocked row when the
 * conflicting transaction commits. Serializable is reserved for the reads that
 * must see a consistent *aggregate* (escrow balance sums), where CAS does not
 * help.
 */

export type Tx = Prisma.TransactionClient;

/** Prisma's default 5s interactive-transaction timeout is too tight for the
 *  money paths, which touch six tables. Explicit, not inherited. */
export const TX_OPTIONS = {
  maxWait: 5_000,
  timeout: 20_000,
} as const;

export class ConcurrentModificationError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
    readonly expected: string,
  ) {
    super(
      `${entity} ${id} was modified concurrently (expected state ${expected}). Retry with fresh state.`,
    );
    this.name = 'ConcurrentModificationError';
  }
}

/**
 * Compare-and-swap on a status column.
 *
 * `updateMany` with the expected status in the WHERE clause compiles to a single
 * conditional UPDATE. Under READ COMMITTED, a second transaction attempting the
 * same swap blocks on the row lock, then re-checks the predicate after the first
 * commits — and matches zero rows. Exactly one caller wins, with no explicit
 * locking and no retry loop.
 */
export async function casStatus<T extends { updateMany: (args: any) => Promise<{ count: number }> }>(
  model: T,
  args: {
    id: string;
    from: string | string[];
    data: Record<string, unknown>;
    entity: string;
  },
): Promise<void> {
  const from = Array.isArray(args.from) ? args.from : [args.from];
  const { count } = await model.updateMany({
    where: { id: args.id, status: { in: from } },
    data: args.data,
  });
  if (count !== 1) {
    throw new ConcurrentModificationError(args.entity, args.id, from.join('|'));
  }
}

/**
 * Transaction-scoped Postgres advisory lock, keyed by an arbitrary string.
 *
 * Used to serialise *job* execution, not user requests: two workers sweeping
 * milestones must not both process the same engagement. Released automatically
 * at commit or rollback, so a crashed worker cannot strand the lock — which is
 * the failure mode that makes application-level "isLocked" columns a bad idea.
 */
export async function acquireAdvisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Non-blocking variant: skip the work rather than queue behind another worker. */
export async function tryAdvisoryLock(tx: Tx, key: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked
  `;
  return rows[0]?.locked === true;
}

const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';

function isRetryable(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string } };
  const code = e?.code ?? e?.meta?.code;
  return code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED;
}

/**
 * Runs a transaction at SERIALIZABLE with bounded retry.
 *
 * Postgres aborts serialization conflicts rather than blocking, so the caller
 * *must* retry — a SERIALIZABLE transaction without a retry loop is a latent
 * 500. Only used where an aggregate read (escrow balance) drives a write.
 */
export async function withSerializableRetry<T>(
  fn: (tx: Tx) => Promise<T>,
  attempts = 3,
  client: PrismaClient = prisma,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await client.$transaction(fn, {
        ...TX_OPTIONS,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) throw error;
      // Full jitter — synchronised retries just re-collide.
      await new Promise((r) => setTimeout(r, Math.random() * 40 * attempt));
    }
  }
  throw lastError;
}

/** Deterministic idempotency key. Same inputs must always produce the same key. */
export function idempotencyKey(...parts: (string | number)[]): string {
  return parts.map((p) => String(p).replace(/[:|]/g, '_')).join(':');
}
