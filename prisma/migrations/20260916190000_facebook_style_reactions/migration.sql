-- Remap LinkedIn-style ReactionType values to Facebook-style lowercase values.
CREATE TYPE "ReactionType_new" AS ENUM ('like', 'love', 'haha', 'wow', 'sad', 'angry');

ALTER TABLE "FeedReaction" ALTER COLUMN "type" DROP DEFAULT;

ALTER TABLE "FeedReaction"
  ALTER COLUMN "type" TYPE "ReactionType_new"
  USING (
    CASE "type"::text
      WHEN 'LIKE' THEN 'like'
      WHEN 'LOVE' THEN 'love'
      WHEN 'CELEBRATE' THEN 'haha'
      WHEN 'SUPPORT' THEN 'wow'
      WHEN 'INSIGHTFUL' THEN 'sad'
      WHEN 'CURIOUS' THEN 'angry'
      ELSE 'like'
    END
  )::"ReactionType_new";

DROP TYPE "ReactionType";

ALTER TYPE "ReactionType_new" RENAME TO "ReactionType";

ALTER TABLE "FeedReaction" ALTER COLUMN "type" SET DEFAULT 'like'::"ReactionType";
