-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('OWNER', 'MEMBER');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "directKey" TEXT;

-- AlterTable
ALTER TABLE "ConversationParticipant" ADD COLUMN "role" "ConversationRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "body" SET DEFAULT '',
ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';

-- Backfill directKey for existing 1:1 conversations that still have both participants.
-- When duplicates exist for the same pair, only the most recently active one gets the key.
UPDATE "Conversation" AS c
SET "directKey" = k."key"
FROM (
    SELECT DISTINCT ON (s."key") s."id", s."key"
    FROM (
        SELECT
            p."conversationId" AS "id",
            string_agg(p."userId", ':' ORDER BY p."userId") AS "key",
            COUNT(*) AS "cnt",
            MAX(cv."updatedAt") AS "updatedAt"
        FROM "ConversationParticipant" p
        JOIN "Conversation" cv ON cv."id" = p."conversationId"
        WHERE cv."isGroup" = false
        GROUP BY p."conversationId"
    ) s
    WHERE s."cnt" = 2
    ORDER BY s."key", s."updatedAt" DESC
) AS k
WHERE c."id" = k."id";

-- Backfill group owners: the earliest participant of each group becomes OWNER.
UPDATE "ConversationParticipant" AS p
SET "role" = 'OWNER'
FROM (
    SELECT DISTINCT ON (cp."conversationId") cp."id"
    FROM "ConversationParticipant" cp
    JOIN "Conversation" cv ON cv."id" = cp."conversationId"
    WHERE cv."isGroup" = true
    ORDER BY cp."conversationId", cp."createdAt" ASC
) AS f
WHERE p."id" = f."id";

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");
