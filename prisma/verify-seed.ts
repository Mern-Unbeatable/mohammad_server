/**
 * Consistency checks for the development database (`npm run db:verify`).
 * Read-only. Each check counts rows that break an invariant the app relies on;
 * the script exits with code 1 if any check finds violations.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "uploads";

const CHECKS: { name: string; sql: string }[] = [
  {
    name: "every user has exactly one profile and one subscription",
    sql: `SELECT count(*) FROM "User" u
          WHERE NOT EXISTS (SELECT 1 FROM "Profile" p WHERE p."userId" = u.id)
             OR NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."userId" = u.id)`,
  },
  {
    name: "profile connectionsCount matches accepted connections",
    sql: `SELECT count(*) FROM "Profile" p
          WHERE p."connectionsCount" <> (SELECT count(*) FROM "Connection" c
            WHERE c.status = 'ACCEPTED' AND (c."requesterId" = p."userId" OR c."addresseeId" = p."userId"))`,
  },
  {
    name: "no self-connections or reverse-duplicate connection pairs",
    sql: `SELECT count(*) FROM "Connection" c
          WHERE c."requesterId" = c."addresseeId"
             OR EXISTS (SELECT 1 FROM "Connection" r WHERE r."requesterId" = c."addresseeId" AND r."addresseeId" = c."requesterId")`,
  },
  {
    name: "direct conversations: 2 participants and directKey = sorted participant ids",
    sql: `SELECT count(*) FROM "Conversation" cv
          WHERE cv."isGroup" = false AND (
            (SELECT count(*) FROM "ConversationParticipant" p WHERE p."conversationId" = cv.id) <> 2
            OR cv."directKey" IS DISTINCT FROM (SELECT string_agg(p."userId", ':' ORDER BY p."userId" COLLATE "C")
                                                FROM "ConversationParticipant" p WHERE p."conversationId" = cv.id))`,
  },
  {
    name: "group conversations: named, exactly one owner, 3+ members",
    sql: `SELECT count(*) FROM "Conversation" cv
          WHERE cv."isGroup" = true AND (
            cv.name IS NULL OR cv."directKey" IS NOT NULL
            OR (SELECT count(*) FROM "ConversationParticipant" p WHERE p."conversationId" = cv.id AND p.role = 'OWNER') <> 1
            OR (SELECT count(*) FROM "ConversationParticipant" p WHERE p."conversationId" = cv.id) < 3)`,
  },
  {
    name: "message senders are participants of the conversation",
    sql: `SELECT count(*) FROM "Message" m
          WHERE NOT EXISTS (SELECT 1 FROM "ConversationParticipant" p
                            WHERE p."conversationId" = m."conversationId" AND p."userId" = m."senderId")`,
  },
  {
    name: "conversation updatedAt is not older than its last message",
    sql: `SELECT count(*) FROM "Conversation" cv
          WHERE cv."updatedAt" < (SELECT max(m."createdAt") FROM "Message" m WHERE m."conversationId" = cv.id)`,
  },
  {
    name: "comment replies belong to the same post as their parent",
    sql: `SELECT count(*) FROM "FeedComment" c JOIN "FeedComment" parent ON parent.id = c."parentCommentId"
          WHERE parent."postId" <> c."postId"`,
  },
  {
    name: "nobody applies to their own job or saves their own listing",
    sql: `SELECT (SELECT count(*) FROM "JobApplication" a JOIN "Job" j ON j.id = a."jobId" WHERE a."applicantId" = j."ownerId")
               + (SELECT count(*) FROM "SavedListing" s JOIN "Listing" l ON l.id = s."listingId" WHERE s."userId" = l."sellerId")`,
  },
  {
    name: "advertisements belong to suppliers",
    sql: `SELECT count(*) FROM "Advertisement" a JOIN "User" u ON u.id = a."supplierId" WHERE u.role <> 'SUPPLIER'`,
  },
  {
    name: "ad status matches its dates (active: live now, expired: ended, pending: never started, rejected: has reason)",
    sql: `SELECT count(*) FROM "Advertisement" a WHERE
            (a.status = 'ACTIVE' AND (a."startDate" IS NULL OR a."startDate" > now() OR a."expiryDate" <= now()))
         OR (a.status = 'EXPIRED' AND (a."expiryDate" IS NULL OR a."expiryDate" > now()))
         OR (a.status = 'PENDING' AND a."startDate" IS NOT NULL)
         OR (a.status = 'REJECTED' AND a."rejectionReason" IS NULL)`,
  },
  {
    name: "subscription state is coherent (paid ACTIVE renews in future with plan price; TRIAL within 90 days)",
    sql: `SELECT count(*) FROM "Subscription" s WHERE
            (s.status = 'ACTIVE' AND s.plan = 'MONTHLY' AND (s.amount <> 1999 OR s."renewalDate" IS NULL OR (s."stripeSubscriptionId" IS NULL AND s."renewalDate" <= now())))
         OR (s.status = 'ACTIVE' AND s.plan = 'YEARLY' AND (s.amount <> 23988 OR s."renewalDate" IS NULL OR (s."stripeSubscriptionId" IS NULL AND s."renewalDate" <= now())))
         OR (s.status = 'TRIAL' AND (s.plan <> 'FREE' OR COALESCE(s."startDate", s."createdAt") + make_interval(days => s."trialDaysTotal") <= now()))`,
  },
  {
    name: "report targets exist",
    sql: `SELECT count(*) FROM "Report" r WHERE r."targetId" IS NOT NULL AND NOT CASE r."targetType"
            WHEN 'POST' THEN EXISTS (SELECT 1 FROM "FeedPost" x WHERE x.id = r."targetId")
            WHEN 'COMMENT' THEN EXISTS (SELECT 1 FROM "FeedComment" x WHERE x.id = r."targetId")
            WHEN 'LISTING' THEN EXISTS (SELECT 1 FROM "Listing" x WHERE x.id = r."targetId")
            WHEN 'JOB' THEN EXISTS (SELECT 1 FROM "Job" x WHERE x.id = r."targetId")
            WHEN 'GENERAL_POST' THEN EXISTS (SELECT 1 FROM "GeneralPost" x WHERE x.id = r."targetId")
            WHEN 'USER' THEN EXISTS (SELECT 1 FROM "User" x WHERE x.id = r."targetId")
          END`,
  },
  {
    name: "resolved reports (and only those) have resolvedAt",
    sql: `SELECT count(*) FROM "Report" r WHERE (r.status = 'RESOLVED') <> (r."resolvedAt" IS NOT NULL)`,
  },
  {
    name: "user warnings equal their WARN moderation actions",
    sql: `SELECT count(*) FROM "User" u
          WHERE u.warnings <> (SELECT count(*) FROM "ModerationLog" m WHERE m."targetUserId" = u.id AND m.action = 'WARN')`,
  },
  {
    name: "suspended/banned users have a matching moderation action",
    sql: `SELECT count(*) FROM "User" u WHERE
            (u.status = 'SUSPENDED' AND NOT EXISTS (SELECT 1 FROM "ModerationLog" m WHERE m."targetUserId" = u.id AND m.action = 'SUSPEND'))
         OR (u.status = 'BANNED' AND NOT EXISTS (SELECT 1 FROM "ModerationLog" m WHERE m."targetUserId" = u.id AND m.action = 'BAN'))`,
  },
  {
    name: "conversation notification links point to a conversation the user is in",
    sql: `SELECT count(*) FROM "Notification" n
          WHERE n.link LIKE '%?conversation=%' AND NOT EXISTS (
            SELECT 1 FROM "ConversationParticipant" p
            WHERE p."userId" = n."userId" AND p."conversationId" = split_part(n.link, '?conversation=', 2))`,
  },
  {
    name: "no timestamps in the future",
    sql: `SELECT (SELECT count(*) FROM "User" WHERE "createdAt" > now() OR "lastLoginAt" > now())
               + (SELECT count(*) FROM "FeedPost" WHERE "createdAt" > now())
               + (SELECT count(*) FROM "FeedComment" WHERE "createdAt" > now())
               + (SELECT count(*) FROM "Message" WHERE "createdAt" > now())
               + (SELECT count(*) FROM "Notification" WHERE "createdAt" > now())
               + (SELECT count(*) FROM "Connection" WHERE "createdAt" > now())
               + (SELECT count(*) FROM "Report" WHERE "createdAt" > now() OR "resolvedAt" > now())`,
  },
  {
    name: "content is not older than its author's account",
    sql: `SELECT (SELECT count(*) FROM "FeedPost" x JOIN "User" u ON u.id = x."authorId" WHERE x."createdAt" < u."createdAt")
               + (SELECT count(*) FROM "FeedComment" x JOIN "User" u ON u.id = x."authorId" WHERE x."createdAt" < u."createdAt")
               + (SELECT count(*) FROM "Listing" x JOIN "User" u ON u.id = x."sellerId" WHERE x."createdAt" < u."createdAt")
               + (SELECT count(*) FROM "Job" x JOIN "User" u ON u.id = x."ownerId" WHERE x."createdAt" < u."createdAt")
               + (SELECT count(*) FROM "Message" x JOIN "User" u ON u.id = x."senderId" WHERE x."createdAt" < u."createdAt")`,
  },
];

const ENUM_COVERAGE: { label: string; sql: string }[] = [
  { label: "User.role", sql: `SELECT role::text AS v, count(*)::int AS n FROM "User" GROUP BY 1 ORDER BY 1` },
  { label: "User.status", sql: `SELECT status::text AS v, count(*)::int AS n FROM "User" GROUP BY 1 ORDER BY 1` },
  { label: "User.profileType", sql: `SELECT "profileType"::text AS v, count(*)::int AS n FROM "User" GROUP BY 1 ORDER BY 1` },
  { label: "Subscription plan/status", sql: `SELECT plan::text || '/' || status::text AS v, count(*)::int AS n FROM "Subscription" GROUP BY 1 ORDER BY 1` },
  { label: "Connection.status", sql: `SELECT status::text AS v, count(*)::int AS n FROM "Connection" GROUP BY 1 ORDER BY 1` },
  { label: "FeedPost.type", sql: `SELECT type::text AS v, count(*)::int AS n FROM "FeedPost" GROUP BY 1 ORDER BY 1` },
  { label: "FeedReaction.type", sql: `SELECT type::text AS v, count(*)::int AS n FROM "FeedReaction" GROUP BY 1 ORDER BY 1` },
  { label: "Listing.category", sql: `SELECT category::text AS v, count(*)::int AS n FROM "Listing" GROUP BY 1 ORDER BY 1` },
  { label: "Listing.condition", sql: `SELECT condition::text AS v, count(*)::int AS n FROM "Listing" GROUP BY 1 ORDER BY 1` },
  { label: "Listing.status", sql: `SELECT status::text AS v, count(*)::int AS n FROM "Listing" GROUP BY 1 ORDER BY 1` },
  { label: "Job.employmentType", sql: `SELECT "employmentType"::text AS v, count(*)::int AS n FROM "Job" GROUP BY 1 ORDER BY 1` },
  { label: "Job.level", sql: `SELECT level::text AS v, count(*)::int AS n FROM "Job" GROUP BY 1 ORDER BY 1` },
  { label: "Job.status", sql: `SELECT status::text AS v, count(*)::int AS n FROM "Job" GROUP BY 1 ORDER BY 1` },
  { label: "JobApplication.status", sql: `SELECT status::text AS v, count(*)::int AS n FROM "JobApplication" GROUP BY 1 ORDER BY 1` },
  { label: "GeneralPost.type", sql: `SELECT type::text AS v, count(*)::int AS n FROM "GeneralPost" GROUP BY 1 ORDER BY 1` },
  { label: "Advertisement category", sql: `SELECT category::text AS v, count(*)::int AS n FROM "Advertisement" GROUP BY 1 ORDER BY 1` },
  { label: "Advertisement status", sql: `SELECT status::text AS v, count(*)::int AS n FROM "Advertisement" GROUP BY 1 ORDER BY 1` },
  { label: "Report.status", sql: `SELECT status::text AS v, count(*)::int AS n FROM "Report" GROUP BY 1 ORDER BY 1` },
  { label: "Report.targetType", sql: `SELECT "targetType"::text AS v, count(*)::int AS n FROM "Report" GROUP BY 1 ORDER BY 1` },
  { label: "ModerationLog.action", sql: `SELECT action::text AS v, count(*)::int AS n FROM "ModerationLog" GROUP BY 1 ORDER BY 1` },
  { label: "Notification.type", sql: `SELECT type::text AS v, count(*)::int AS n FROM "Notification" GROUP BY 1 ORDER BY 1` },
];

async function main(): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT tablename AS t FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations' ORDER BY 1`,
  );
  console.log("Row counts");
  for (const { t } of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t.replace(/"/g, '""')}"`);
    console.log(`  ${t.padEnd(26)} ${n}`);
  }

  console.log("\nValue coverage");
  for (const { label, sql } of ENUM_COVERAGE) {
    const rows = await prisma.$queryRawUnsafe<{ v: string; n: number }[]>(sql);
    console.log(`  ${label.padEnd(26)} ${rows.map((r) => `${r.v}=${r.n}`).join("  ")}`);
  }

  console.log("\nConsistency checks");
  let failures = 0;
  for (const check of CHECKS) {
    const [row] = await prisma.$queryRawUnsafe<Record<string, bigint | number>[]>(check.sql);
    const violations = Number(Object.values(row)[0]);
    if (violations > 0) failures += 1;
    console.log(`  ${violations === 0 ? "PASS" : `FAIL (${violations})`}  ${check.name}`);
  }

  const seedDocs = await prisma.$queryRawUnsafe<{ url: string }[]>(
    `SELECT "documentUrl" AS url FROM "FeedPost" WHERE "documentUrl" LIKE '%/seed/%'
     UNION SELECT "documentUrl" FROM "GeneralPost" WHERE "documentUrl" LIKE '%/seed/%'
     UNION SELECT a->>'url' FROM "Message", jsonb_array_elements(attachments) a WHERE a->>'url' LIKE '%/seed/%'`,
  );
  const missing = seedDocs.filter(({ url }) => !fs.existsSync(path.resolve(process.cwd(), UPLOAD_DIR, "seed", path.basename(url))));
  if (missing.length > 0) failures += 1;
  console.log(`  ${missing.length === 0 ? "PASS" : `FAIL (${missing.length})`}  seed documents referenced in the database exist on disk`);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
