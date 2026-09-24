-- Reviews on programs that ended early (cancelled after a released lesson, or
-- closed by a dispute) are allowed and labelled on the coach's profile.
ALTER TABLE "Review" ADD COLUMN "programIncomplete" BOOLEAN NOT NULL DEFAULT false;
