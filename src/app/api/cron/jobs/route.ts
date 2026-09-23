import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { runFrequentJobs } from '@/jobs/workers';

/**
 * The 5-minute tick, reachable over HTTP.
 *
 * `runFrequentJobs` (offer expiry, hold expiry, checkout reconciliation, the
 * milestone worker, provider approval, refund submission) is safe behind a
 * stateless cron hit — see the scheduling note on that function. `runPayoutBatch`
 * is deliberately NOT called here; it needs a queue with retry/visibility, not
 * a request that can time out mid-transfer.
 *
 * Point a scheduler at this route every 5 minutes:
 *   - Vercel Cron: see `vercel.json` at the repo root.
 *   - Anything else: any scheduler that can POST with a Bearer token works.
 */
export const dynamic = 'force-dynamic';

function authorised(request: NextRequest): boolean {
  if (!env.CRON_SECRET) return true; // dev: no secret configured, run open
  return request.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`;
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await runFrequentJobs();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[cron/jobs] run failed', error);
    return NextResponse.json({ ok: false, error: 'run_failed' }, { status: 500 });
  }
}

/** Vercel Cron issues GET requests. */
export async function GET(request: NextRequest) {
  return POST(request);
}
