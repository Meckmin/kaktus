-- Append-only record of which version of which legal text a user accepted.
CREATE TABLE "LegalConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "context" TEXT,
    "ipHash" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalConsent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LegalConsent_userId_document_idx" ON "LegalConsent"("userId", "document");

ALTER TABLE "LegalConsent" ADD CONSTRAINT "LegalConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
