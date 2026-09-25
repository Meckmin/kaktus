-- Existing "ACTIVE" engagements with no captured payment are abandoned or
-- in-flight checkouts: move them to PENDING_PAYMENT.
UPDATE "Engagement" e
SET status = 'PENDING_PAYMENT'
WHERE e.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p."offerId" = e."offerId"
      AND p.status IN ('CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED')
  );

-- The checkout path never incremented the counter while completion and
-- cancellation always decremented it, so it had drifted. Recount.
UPDATE "CoachProfile" c
SET "activeEngagements" = (
  SELECT count(*) FROM "Engagement" e
  WHERE e."coachProfileId" = c.id AND e.status = 'ACTIVE'
);
