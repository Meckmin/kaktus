#!/usr/bin/env node
/**
 * Manual trigger for the weekly payout batch — only does real work under the
 * mock provider (PAYMENT_PROVIDER=mock); no-ops under Iyzico by design. Not on
 * any automatic schedule — see src/app/api/cron/payouts/route.ts for why.
 *
 *   node scripts/run-payouts.mjs
 *   node scripts/run-payouts.mjs --base http://localhost:3000
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const BASE_URL = flag('base', process.env.APP_URL ?? 'http://localhost:3000');
const SECRET = flag('secret', process.env.CRON_SECRET);

const res = await fetch(`${BASE_URL}/api/cron/payouts`, {
  method: 'POST',
  headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {},
});
const body = await res.json();
console.log(`→ HTTP ${res.status}`);
console.log(JSON.stringify(body, null, 2));
process.exit(res.ok ? 0 : 1);
