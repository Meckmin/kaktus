import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { runPayoutBatch } from '@/jobs/workers';

/**
 * The weekly payout batch, reachable over HTTP — deliberately NOT on any
 * automatic schedule (not in vercel.json, unlike /api/cron/jobs).
 *
 * `runPayoutBatch` no-ops entirely under the Iyzico provider (see its doc
 * comment in jobs/workers.ts) — Iyzico settles to the coach directly, so this
 * only does real work against the mock provider, in dev or a demo. Under any
 * provider that actually moves money, a stateless HTTP request that can time
 * out mid-transfer with no retry/visibility is the wrong trigger; wire this to
 * a real queue (pg-boss, Inngest) before scheduling it automatically.
 *
 * Until then: manual trigger only, via `npm run jobs:payouts`.
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
    const result = await runPayoutBatch();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[cron/payouts] run failed', error);
    return NextResponse.json({ ok: false, error: 'run_failed' }, { status: 500 });
  }
}
