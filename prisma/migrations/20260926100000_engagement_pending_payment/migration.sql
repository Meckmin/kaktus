-- Engagements are created when checkout opens (their milestones become the
-- Iyzico basket lines) but were created ACTIVE, so an abandoned checkout left
-- an "active" program with no money behind it. They now start here and become
-- ACTIVE when the payment is captured. Separate migration: a new enum value
-- can't be used in the transaction that adds it.
ALTER TYPE "EngagementStatus" ADD VALUE 'PENDING_PAYMENT' BEFORE 'ACTIVE';
