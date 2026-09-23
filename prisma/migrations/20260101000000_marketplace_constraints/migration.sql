-- Invariants Prisma's schema language cannot express.
-- Run AFTER the generated table migration.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Slot exclusivity.
-- A coach cannot have two live holds, or a live hold and a scheduled booking,
-- covering the same instant. This is the double-booking guarantee. An
-- application-level "SELECT then INSERT" loses this race; the database does not.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "SlotHold"
  ADD CONSTRAINT slot_hold_no_overlap
  EXCLUDE USING gist (
    "coachProfileId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status = 'HELD');

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    "coachProfileId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status = 'SCHEDULED');

-- Holds and bookings must also not collide with each other. Postgres cannot
-- EXCLUDE across two tables, so a trigger closes the gap.
CREATE OR REPLACE FUNCTION assert_no_cross_slot_overlap() RETURNS trigger AS $$
BEGIN
  -- Cast to text before comparing: this one function is a trigger on two
  -- tables whose `status` columns are two different enum types (HoldStatus,
  -- BookingStatus). PL/pgSQL resolves NEW.status's type once for the whole
  -- compiled function body, so comparing it directly against a literal from
  -- the *other* table's enum fails to parse — Postgres has no way to see that
  -- the TG_TABLE_NAME check makes the comparison unreachable for the wrong
  -- table. Text has no such ambiguity.
  IF TG_TABLE_NAME = 'SlotHold' AND NEW.status::text <> 'HELD' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'Booking'  AND NEW.status::text <> 'SCHEDULED' THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'SlotHold' THEN
    IF EXISTS (
      SELECT 1 FROM "Booking" b
      WHERE b."coachProfileId" = NEW."coachProfileId"
        AND b.status = 'SCHEDULED'
        AND tstzrange(b."startsAt", b."endsAt", '[)') && tstzrange(NEW."startsAt", NEW."endsAt", '[)')
    ) THEN
      RAISE EXCEPTION 'SLOT_TAKEN: hold overlaps an existing booking'
        USING ERRCODE = 'exclusion_violation';
    END IF;
  ELSE
    -- No offerId exception here: "Booking" has no offerId column (it carries
    -- engagementId/milestoneId instead), and none is needed — holds.ts always
    -- flips a hold's own status to CONVERTED before creating its booking (see
    -- convertHoldsToBookings), so the h.status = 'HELD' filter below already
    -- excludes it without needing to compare offer identity.
    IF EXISTS (
      SELECT 1 FROM "SlotHold" h
      WHERE h."coachProfileId" = NEW."coachProfileId"
        AND h.status = 'HELD'
        AND tstzrange(h."startsAt", h."endsAt", '[)') && tstzrange(NEW."startsAt", NEW."endsAt", '[)')
    ) THEN
      RAISE EXCEPTION 'SLOT_TAKEN: booking overlaps a live hold'
        USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER slot_hold_cross_check
  BEFORE INSERT OR UPDATE ON "SlotHold"
  FOR EACH ROW EXECUTE FUNCTION assert_no_cross_slot_overlap();

CREATE TRIGGER booking_cross_check
  BEFORE INSERT OR UPDATE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION assert_no_cross_slot_overlap();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Ledger integrity. Every entry group must balance to zero, checked at
-- COMMIT so multi-row inserts inside one transaction are legal.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assert_ledger_balanced() RETURNS trigger AS $$
DECLARE
  imbalance BIGINT;
BEGIN
  SELECT COALESCE(SUM(
    CASE WHEN direction = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END
  ), 0)
  INTO imbalance
  FROM "LedgerEntry"
  WHERE "entryGroupId" = COALESCE(NEW."entryGroupId", OLD."entryGroupId");

  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'LEDGER_IMBALANCE: group % is off by % minor units',
      COALESCE(NEW."entryGroupId", OLD."entryGroupId"), imbalance;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_balanced
  AFTER INSERT OR UPDATE OR DELETE ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();

-- Ledger rows are append-only. Corrections are new reversing groups.
CREATE RULE ledger_no_delete AS ON DELETE TO "LedgerEntry" DO INSTEAD NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Value constraints
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Review"      ADD CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "Offer"       ADD CONSTRAINT offer_price_positive CHECK ("priceMinor" > 0);
ALTER TABLE "Offer"       ADD CONSTRAINT offer_commission_range CHECK ("commissionBps" BETWEEN 0 AND 5000);
ALTER TABLE "Offer"       ADD CONSTRAINT offer_dates_ordered CHECK ("endDate" > "startDate");
ALTER TABLE "Milestone"   ADD CONSTRAINT milestone_amount_positive CHECK ("amountMinor" > 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_amount_positive CHECK ("amountMinor" > 0);
ALTER TABLE "SlotHold"    ADD CONSTRAINT hold_range_ordered CHECK ("endsAt" > "startsAt");
ALTER TABLE "Booking"     ADD CONSTRAINT booking_range_ordered CHECK ("endsAt" > "startsAt");
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT availability_minutes_valid
  CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT availability_weekday_valid
  CHECK (weekday BETWEEN 0 AND 6);

-- Only approved coaches may be discoverable. Enforced here as well as in query
-- code, because a discovery bug that surfaces unverified coaches is a trust
-- incident, not a cosmetic one.
CREATE INDEX coach_discoverable_idx ON "CoachProfile" ("acceptingStudents", "ratingAvg" DESC)
  WHERE "verificationStatus" = 'APPROVED';

-- Hot path: expiry sweeps.
CREATE INDEX hold_expiry_sweep_idx ON "SlotHold" ("expiresAt") WHERE status = 'HELD';
CREATE INDEX offer_expiry_sweep_idx ON "Offer" ("expiresAt") WHERE status IN ('OFFERED', 'COUNTERED');
CREATE INDEX milestone_release_sweep_idx ON "Milestone" ("autoReleaseAt")
  WHERE status = 'PENDING_CONFIRMATION';
