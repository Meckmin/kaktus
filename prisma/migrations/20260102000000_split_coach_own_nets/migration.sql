-- Splits CoachProfile's combined "own net" trajectory field into TYT/AYT,
-- mirroring StudentProfile.baselineTytNet/baselineAytNet. See
-- lib/matching/engine.ts for how the matcher recombines them for scoring.
ALTER TABLE "CoachProfile" DROP COLUMN "ownBaselineNet";
ALTER TABLE "CoachProfile" DROP COLUMN "ownFinalNet";
ALTER TABLE "CoachProfile" ADD COLUMN "ownBaselineTytNet" DOUBLE PRECISION;
ALTER TABLE "CoachProfile" ADD COLUMN "ownFinalTytNet" DOUBLE PRECISION;
ALTER TABLE "CoachProfile" ADD COLUMN "ownBaselineAytNet" DOUBLE PRECISION;
ALTER TABLE "CoachProfile" ADD COLUMN "ownFinalAytNet" DOUBLE PRECISION;
