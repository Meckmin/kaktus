#!/usr/bin/env node
/**
 * Manual trigger for the 5-minute job tick — nothing schedules it locally, so
 * this is how you make auto-release, offer expiry, etc. actually run in dev.
 *
 *   node scripts/run-jobs.mjs
 *   node scripts/run-jobs.mjs --base http://localhost:3000
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const BASE_URL = flag('base', process.env.APP_URL ?? 'http://localhost:3000');
const SECRET = flag('secret', process.env.CRON_SECRET);

const res = await fetch(`${BASE_URL}/api/cron/jobs`, {
  method: 'POST',
  headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {},
});
const body = await res.json();
console.log(`→ HTTP ${res.status}`);
console.log(JSON.stringify(body, null, 2));
process.exit(res.ok ? 0 : 1);
