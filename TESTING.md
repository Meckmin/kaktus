# Running the test suite

## Pure unit tests — no database

```bash
npx vitest run tests/core.test.ts
```

Covers the matchmaking scorer, the offer FSM's transition table, commission and
milestone arithmetic, and the anti-circumvention filter. All pure functions, all
fast, safe to run on every save.

## Integration and concurrency tests — real Postgres required

```bash
docker compose -f docker-compose.test.yml up -d
export DATABASE_URL=postgresql://kaktus:kaktus@localhost:5433/kaktus_test
export DIRECT_DATABASE_URL=$DATABASE_URL
npx prisma migrate deploy        # includes the exclusion-constraint migration
npx vitest run tests/concurrency.integration.test.ts
```

**The constraints migration is not optional.** Every slot-contention test passes
trivially against a schema without the `EXCLUDE` constraints and the cross-table
trigger, because the guarantee under test lives in the database rather than in
application code. If `prisma migrate deploy` skips
`20260101000000_marketplace_constraints`, the suite is testing nothing.

Prisma's connection pool defaults to roughly `num_cpus * 2 + 1`. The 20-way slot
contention test needs more than that or it serialises through the pool and the
race never actually happens:

```bash
export DATABASE_URL="$DATABASE_URL?connection_limit=30&pool_timeout=20"
```

## What is and is not proven

Verified by these tests:

- Exclusive slot acquisition under simultaneous contention, including partial
  overlaps and hold-versus-booking collisions across tables.
- Exactly-once offer acceptance under 10-way concurrency.
- Auto-release and dispute freezing never both apply to one milestone.
- Ledger groups always balance; escrow never goes negative.
- Payout batching is idempotent under concurrent worker runs.

Not covered, and worth adding before launch:

- Iyzico sandbox behaviour, including 3DS callbacks and webhook replay from the
  real provider. The mock provider is deterministic by design and will not
  reproduce their retry semantics.
- Multi-process contention. `Promise.all` interleaves at the database, which is
  where the locking lives, but it does not exercise two Node processes racing.
  Run the suite against two workers before trusting the payout batch at volume.
- Clock skew between application servers. `autoReleaseAt` is compared against
  each worker's local clock; on a fleet, use `now()` from the database instead.
