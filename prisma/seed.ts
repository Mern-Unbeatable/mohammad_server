/**
 * Development seed for Lab Unity.
 *
 *   npm run db:seed    seed an empty database (aborts if users already exist)
 *   npm run db:reset   clear every table (schema and migrations untouched), then seed
 *   npm run db:verify  check the seeded data for consistency
 *
 * Resetting a non-local database additionally requires `-- --allow-remote`.
 * Seeding refuses to run when NODE_ENV=production.
 *
 * All demo accounts share the password SEED_ADMIN_PASSWORD (default Demo123!).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AdStatus,
  ConversationRole,
  NotificationType,
  Prisma,
  PrismaClient,
  ReactionType,
  ReportStatus,
  Role,
  SubscriptionPlan,
  SubscriptionStatus,
  UserStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import {
  ADMIN_ACTIONS,
  ADS,
  APP_SETTINGS,
  BLOGS,
  CONNECTIONS,
  CONVERSATIONS,
  FEED_POSTS,
  GENERAL_POSTS,
  JOBS,
  LAB_IMAGES,
  LISTINGS,
  PEOPLE,
  REPORTS,
  SEED_DOCUMENTS,
  type LabImage,
  type SeedPerson,
  type SubscriptionScenario,
  portraitUrl,
  unsplash,
} from "./seed-data";

dotenv.config();

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const RESET = args.has("--reset");
const ALLOW_REMOTE = args.has("--allow-remote");

const DEMO_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Demo123!";
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "uploads";
const TRIAL_DAYS = 90;
const MONTHLY_CENTS = 1999;
const YEARLY_CENTS = 23988;

// ---------------------------------------------------------------------------
// Deterministic helpers (same content on every run; dates relative to now)
// ---------------------------------------------------------------------------

const NOW = new Date();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let prngState = 20260930;
/** mulberry32 — deterministic pseudo-random numbers in [0, 1). */
const random = (): number => {
  prngState = (prngState + 0x6d2b79f5) | 0;
  let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

/** A moment `days` ago, shifted back by up to 6 hours so records don't share a timestamp. */
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY - Math.floor(random() * 6 * HOUR));
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * MINUTE);
const plusMinutes = (date: Date, minutes: number): Date => new Date(date.getTime() + minutes * MINUTE);
const latest = (...dates: Date[]): Date => new Date(Math.max(...dates.map((d) => d.getTime())));
const notFuture = (date: Date): Date => (date.getTime() > NOW.getTime() - MINUTE ? new Date(NOW.getTime() - MINUTE) : date);
const addMonths = (date: Date, months: number): Date => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};
const newId = (): string => crypto.randomUUID();
const truncate = (text: string, max = 120): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const imageUrl = (key: LabImage, width = 1000): string => unsplash(LAB_IMAGES[key], width);
const documentUrl = (file: string): string => `${PUBLIC_URL}/${UPLOAD_DIR}/seed/${file}`;

// ---------------------------------------------------------------------------
// Safety guard + reset
// ---------------------------------------------------------------------------

const describeTarget = () => {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return {
    label: `${host}:${url.port || "5432"}/${url.pathname.replace(/^\//, "")}`,
    isLocal: ["localhost", "127.0.0.1", "::1"].includes(host),
  };
};

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Empties every application table in the current schema; the schema and migration history are untouched. */
const truncateAll = async (tx: Prisma.TransactionClient): Promise<number> => {
  const tables = await tx.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return 0;
  await tx.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => quoteIdent(t.tablename)).join(", ")} RESTART IDENTITY CASCADE`,
  );
  return tables.length;
};

// ---------------------------------------------------------------------------
// Sample PDFs served from /uploads/seed
// ---------------------------------------------------------------------------

const pdfEscape = (text: string): string => text.replace(/[\\()]/g, (c) => `\\${c}`);

const buildPdf = (title: string): Buffer => {
  const stream = [
    `BT /F1 20 Tf 72 770 Td (${pdfEscape(title)}) Tj ET`,
    "BT /F1 11 Tf 72 740 Td (Sample document generated by the Lab Unity development seed.) Tj ET",
    "BT /F1 11 Tf 72 722 Td (Contents are fictional and for testing only.) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
};

/** Writes the sample PDFs and returns their sizes in bytes. */
const writeSeedDocuments = (): Map<string, number> => {
  const dir = path.resolve(process.cwd(), UPLOAD_DIR, "seed");
  fs.mkdirSync(dir, { recursive: true });
  const sizes = new Map<string, number>();
  for (const [file, title] of Object.entries(SEED_DOCUMENTS)) {
    const pdf = buildPdf(title);
    fs.writeFileSync(path.join(dir, file), pdf);
    sizes.set(file, pdf.length);
  }
  return sizes;
};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const subscriptionFor = (
  userId: string,
  scenario: SubscriptionScenario,
  joinedAt: Date,
): Prisma.SubscriptionCreateManyInput => {
  const base = { id: newId(), userId, trialDaysTotal: TRIAL_DAYS, trialDaysLeft: 0, createdAt: joinedAt, updatedAt: joinedAt };
  switch (scenario.kind) {
    case "free":
      return { ...base, plan: SubscriptionPlan.FREE, status: SubscriptionStatus.ACTIVE };
    case "trial": {
      const startDate = daysAgo(scenario.startedDaysAgo);
      return {
        ...base,
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.TRIAL,
        startDate,
        trialDaysLeft: Math.max(0, TRIAL_DAYS - scenario.startedDaysAgo),
        createdAt: startDate,
        updatedAt: startDate,
      };
    }
    case "trialExpired":
      return { ...base, plan: SubscriptionPlan.FREE, status: SubscriptionStatus.EXPIRED, startDate: joinedAt };
    case "monthly":
    case "yearly": {
      const yearly = scenario.kind === "yearly";
      const startDate = daysAgo(scenario.startedDaysAgo);
      const renewalDate = addMonths(startDate, yearly ? 12 : 1);
      return {
        ...base,
        plan: yearly ? SubscriptionPlan.YEARLY : SubscriptionPlan.MONTHLY,
        status: SubscriptionStatus.ACTIVE,
        amount: yearly ? YEARLY_CENTS : MONTHLY_CENTS,
        billingCycle: yearly ? "Yearly" : "Monthly",
        startDate,
        renewalDate,
        nextPayment: renewalDate,
        paymentMethod: "Card",
        updatedAt: startDate,
      };
    }
    case "cancelled": {
      const startDate = daysAgo(scenario.startedDaysAgo);
      return {
        ...base,
        plan: SubscriptionPlan.MONTHLY,
        status: SubscriptionStatus.CANCELLED,
        amount: MONTHLY_CENTS,
        billingCycle: "Monthly",
        startDate,
        renewalDate: addMonths(startDate, 1),
        paymentMethod: "Card",
        updatedAt: plusMinutes(startDate, 3 * 24 * 60),
      };
    }
    case "lapsed": {
      const startDate = daysAgo(70);
      return {
        ...base,
        plan: SubscriptionPlan.MONTHLY,
        status: SubscriptionStatus.EXPIRED,
        amount: MONTHLY_CENTS,
        billingCycle: "Monthly",
        startDate,
        renewalDate: addMonths(startDate, 1),
        paymentMethod: "Card",
        updatedAt: addMonths(startDate, 1),
      };
    }
  }
};

const initialsOf = (p: SeedPerson): string => `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
const nameOf = (p: SeedPerson): string => `${p.firstName} ${p.lastName}`;
const messagesPathForRole = (role: Role): string =>
  role === Role.SUPPLIER ? "/supplier/chat" : role === Role.ADMIN ? "/admin/chat" : "/chat";

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(tx: Prisma.TransactionClient, passwordHash: string, docSizes: Map<string, number>) {
  // --- Users, profiles, subscriptions -------------------------------------
  const people = new Map<string, { id: string; person: SeedPerson; joinedAt: Date }>();
  for (const person of PEOPLE) {
    people.set(person.key, { id: newId(), person, joinedAt: daysAgo(person.joinedDaysAgo) });
  }
  const user = (key: string) => {
    const entry = people.get(key);
    if (!entry) throw new Error(`Unknown person key in seed data: ${key}`);
    return entry;
  };

  const acceptedCount = new Map<string, number>();
  for (const [a, b, status] of CONNECTIONS) {
    if (status !== "ACCEPTED") continue;
    acceptedCount.set(a, (acceptedCount.get(a) ?? 0) + 1);
    acceptedCount.set(b, (acceptedCount.get(b) ?? 0) + 1);
  }

  await tx.user.createMany({
    data: [...people.values()].map(({ id, person, joinedAt }) => ({
      id,
      email: person.email.toLowerCase(),
      passwordHash,
      role: person.role,
      profileType: person.profileType,
      status: person.status ?? UserStatus.ACTIVE,
      warnings: person.warnings ?? 0,
      lastLoginAt: person.lastLoginDaysAgo === undefined ? null : latest(joinedAt, daysAgo(person.lastLoginDaysAgo)),
      createdAt: joinedAt,
      updatedAt: joinedAt,
    })),
  });

  await tx.profile.createMany({
    data: [...people.values()].map(({ id, person, joinedAt }) => ({
      id: newId(),
      userId: id,
      firstName: person.firstName,
      lastName: person.lastName,
      title: person.title,
      company: person.company,
      country: person.country,
      location: `${person.city}, ${person.country}`,
      phone: person.phone ?? null,
      about: person.about,
      aboutExtended: person.aboutExtended ?? null,
      avatarUrl: person.avatar ? portraitUrl(person.avatar) : null,
      coverUrl: person.cover ? imageUrl(person.cover, 1600) : null,
      initials: initialsOf(person),
      connectionsCount: acceptedCount.get(person.key) ?? 0,
      createdAt: joinedAt,
      updatedAt: joinedAt,
    })),
  });

  await tx.subscription.createMany({
    data: [...people.values()].map(({ id, person, joinedAt }) => subscriptionFor(id, person.subscription, joinedAt)),
  });

  const notifications: Prisma.NotificationCreateManyInput[] = [];
  const notify = (
    key: string,
    type: NotificationType,
    title: string,
    createdAt: Date,
    extra: { subtitle?: string | null; link?: string | null; read?: boolean } = {},
  ) => {
    const at = notFuture(createdAt);
    notifications.push({
      id: newId(),
      userId: user(key).id,
      type,
      title,
      subtitle: extra.subtitle ?? null,
      link: extra.link ?? null,
      read: extra.read ?? NOW.getTime() - at.getTime() > 3 * DAY,
      createdAt: at,
    });
  };

  for (const { person, joinedAt } of people.values()) {
    notify(person.key, NotificationType.SYSTEM, "Welcome to Lab Unity", plusMinutes(joinedAt, 1), {
      subtitle: "Complete your profile to get discovered by labs and suppliers.",
      link: person.role === Role.SUPPLIER ? "/supplier/profile" : person.role === Role.ADMIN ? "/admin/profile" : "/profile",
    });
    if (person.subscription.kind === "trial" && TRIAL_DAYS - person.subscription.startedDaysAgo <= 7) {
      notify(person.key, NotificationType.SYSTEM, "Your free trial ends soon", daysAgo(1), {
        subtitle: `${TRIAL_DAYS - person.subscription.startedDaysAgo} days left — choose a plan to keep full access.`,
        link: "/subscription",
      });
    }
  }

  // --- Connections --------------------------------------------------------
  const connectionRows: Prisma.ConnectionCreateManyInput[] = [];
  for (const [a, b, status] of CONNECTIONS) {
    const requester = user(a);
    const addressee = user(b);
    const earliest = latest(requester.joinedAt, addressee.joinedAt);
    const spanDays = Math.max(0, (NOW.getTime() - earliest.getTime()) / DAY - 0.5);
    const createdAt = notFuture(latest(plusMinutes(earliest, 60), daysAgo(random() * spanDays)));
    const updatedAt = status === "PENDING" ? createdAt : notFuture(plusMinutes(createdAt, 60 + random() * 2000));
    connectionRows.push({ id: newId(), requesterId: requester.id, addresseeId: addressee.id, status, createdAt, updatedAt });

    if (status === "PENDING") {
      notify(b, NotificationType.CONNECTION_REQUEST, "New connection request", createdAt, {
        subtitle: `${nameOf(requester.person)} wants to connect with you`,
        link: `/contacts/${requester.id}`,
      });
    } else if (status === "ACCEPTED") {
      notify(a, NotificationType.CONNECTION_ACCEPTED, "Connection accepted", updatedAt, {
        subtitle: `${nameOf(addressee.person)} accepted your connection request`,
        link: `/contacts/${addressee.id}`,
      });
    }
  }
  await tx.connection.createMany({ data: connectionRows });

  // --- Feed ---------------------------------------------------------------
  const postIds: string[] = [];
  const commentIdsByPost: string[][] = [];
  const postRows: Prisma.FeedPostCreateManyInput[] = [];
  const commentRows: Prisma.FeedCommentCreateManyInput[] = [];
  const commentLikeRows: Prisma.FeedCommentLikeCreateManyInput[] = [];
  const reactionRows: Prisma.FeedReactionCreateManyInput[] = [];

  for (const post of FEED_POSTS) {
    const author = user(post.author);
    const postId = newId();
    const createdAt = notFuture(latest(plusMinutes(author.joinedAt, 30), daysAgo(post.daysAgo)));
    postIds.push(postId);
    postRows.push({
      id: postId,
      authorId: author.id,
      type: post.type,
      content: post.content,
      imageUrl: post.image ? imageUrl(post.image) : null,
      documentUrl: post.document ? documentUrl(post.document) : null,
      createdAt,
      updatedAt: createdAt,
    });

    for (const [type, keys] of Object.entries(post.reactions ?? {})) {
      for (const key of keys ?? []) {
        const at = notFuture(plusMinutes(createdAt, 5 + random() * 600));
        reactionRows.push({ id: newId(), postId, userId: user(key).id, type: type as ReactionType, createdAt: at });
        if (key !== post.author) {
          notify(post.author, NotificationType.REACTION, "New reaction on your post", at, {
            subtitle: `${nameOf(user(key).person)} reacted ${type} to your post`,
            link: "/feed",
          });
        }
      }
    }

    const topLevelIds: string[] = [];
    let cursor = createdAt;
    for (const comment of post.comments ?? []) {
      cursor = notFuture(plusMinutes(cursor, 20 + random() * 180));
      const commentId = newId();
      topLevelIds.push(commentId);
      commentRows.push({ id: commentId, postId, authorId: user(comment.author).id, content: comment.content, createdAt: cursor });
      for (const liker of comment.likes ?? []) {
        commentLikeRows.push({ id: newId(), commentId, userId: user(liker).id, createdAt: notFuture(plusMinutes(cursor, 10)) });
      }
      if (comment.author !== post.author) {
        notify(post.author, NotificationType.COMMENT, "New comment on your post", cursor, { link: "/feed" });
      }
      for (const reply of comment.replies ?? []) {
        cursor = notFuture(plusMinutes(cursor, 10 + random() * 120));
        const replyId = newId();
        commentRows.push({
          id: replyId,
          postId,
          authorId: user(reply.author).id,
          content: reply.content,
          parentCommentId: commentId,
          createdAt: cursor,
        });
        for (const liker of reply.likes ?? []) {
          commentLikeRows.push({ id: newId(), commentId: replyId, userId: user(liker).id, createdAt: notFuture(plusMinutes(cursor, 5)) });
        }
        if (reply.author !== post.author) {
          notify(post.author, NotificationType.COMMENT, "New reply on your post", cursor, { link: "/feed" });
        }
      }
    }
    commentIdsByPost.push(topLevelIds);
  }
  await tx.feedPost.createMany({ data: postRows });
  await tx.feedComment.createMany({ data: commentRows.filter((c) => !c.parentCommentId) });
  await tx.feedComment.createMany({ data: commentRows.filter((c) => c.parentCommentId) });
  await tx.feedCommentLike.createMany({ data: commentLikeRows });
  await tx.feedReaction.createMany({ data: reactionRows });

  // --- Marketplace --------------------------------------------------------
  const listingIds: string[] = [];
  const listingRows: Prisma.ListingCreateManyInput[] = [];
  const savedRows: Prisma.SavedListingCreateManyInput[] = [];
  for (const listing of LISTINGS) {
    const seller = user(listing.seller);
    const id = newId();
    const createdAt = notFuture(latest(plusMinutes(seller.joinedAt, 60), daysAgo(listing.daysAgo)));
    listingIds.push(id);
    listingRows.push({
      id,
      sellerId: seller.id,
      title: listing.title,
      description: listing.description,
      condition: listing.condition,
      category: listing.category,
      year: listing.year ?? null,
      price: listing.priceEur * 100,
      location: listing.location,
      images: listing.images.map((key) => imageUrl(key)),
      status: listing.status ?? "ACTIVE",
      createdAt,
      updatedAt: listing.status && listing.status !== "ACTIVE" ? notFuture(plusMinutes(createdAt, 3 * 24 * 60)) : createdAt,
    });
    for (const key of listing.savedBy ?? []) {
      savedRows.push({ id: newId(), userId: user(key).id, listingId: id, createdAt: notFuture(plusMinutes(createdAt, 60 + random() * 1440)) });
    }
  }
  await tx.listing.createMany({ data: listingRows });
  await tx.savedListing.createMany({ data: savedRows });

  notify("elise", NotificationType.LISTING_ENQUIRY, "Listing enquiry", daysAgo(1), {
    subtitle: "Hi, is the Agilent 1260 still available? Could you share the service history?",
    link: `/marketplace/${listingIds[0]}`,
  });
  notify("julien", NotificationType.LISTING_ENQUIRY, "Listing enquiry", daysAgo(2), {
    subtitle: "Would you consider €16,500 for the inverted microscope if we collect in Paris?",
    link: `/marketplace/${listingIds[13]}`,
  });

  // --- Recruitment --------------------------------------------------------
  const jobIds: string[] = [];
  const jobRows: Prisma.JobCreateManyInput[] = [];
  const applicationRows: Prisma.JobApplicationCreateManyInput[] = [];
  for (const job of JOBS) {
    const owner = user(job.owner);
    const id = newId();
    const createdAt = notFuture(latest(plusMinutes(owner.joinedAt, 60), daysAgo(job.daysAgo)));
    jobIds.push(id);
    jobRows.push({
      id,
      ownerId: owner.id,
      title: job.title,
      company: job.company,
      location: job.location,
      employmentType: job.employmentType,
      level: job.level,
      salary: job.salary ?? null,
      applyLink: null,
      imageUrl: job.image ? imageUrl(job.image) : null,
      about: job.about,
      requirements: job.requirements,
      status: job.status ?? "OPEN",
      createdAt,
      updatedAt: createdAt,
    });
    for (const application of job.applications ?? []) {
      const applicant = user(application.applicant);
      const at = notFuture(latest(plusMinutes(createdAt, 120 + random() * 2880), plusMinutes(applicant.joinedAt, 60)));
      applicationRows.push({
        id: newId(),
        jobId: id,
        applicantId: applicant.id,
        coverLetter: application.coverLetter ?? null,
        status: application.status,
        createdAt: at,
      });
      notify(job.owner, NotificationType.JOB_APPLICATION, "New job application", at, {
        subtitle: `${nameOf(applicant.person)} applied to ${job.title}`,
        link: `/recruitment/${id}`,
      });
    }
  }
  await tx.job.createMany({ data: jobRows });
  await tx.jobApplication.createMany({ data: applicationRows });

  notify("chiara", NotificationType.JOB_MATCH, "New job matching your profile", daysAgo(3), {
    subtitle: `${JOBS[1].title} at ${JOBS[1].company}`,
    link: `/recruitment/${jobIds[1]}`,
  });
  notify("nadia", NotificationType.JOB_MATCH, "New job matching your profile", daysAgo(5), {
    subtitle: `${JOBS[0].title} at ${JOBS[0].company}`,
    link: `/recruitment/${jobIds[0]}`,
  });

  // --- General posts & blogs ---------------------------------------------
  await tx.generalPost.createMany({
    data: GENERAL_POSTS.map((post) => {
      const createdAt = daysAgo(post.daysAgo);
      return {
        id: newId(),
        authorId: user(post.author).id,
        type: post.type,
        title: post.title,
        summary: post.summary,
        category: post.category,
        source: post.source,
        imageUrl: post.image ? imageUrl(post.image) : null,
        documentUrl: post.document ? documentUrl(post.document) : null,
        body: post.body,
        createdAt,
        updatedAt: createdAt,
      };
    }),
  });

  await tx.blog.createMany({
    data: BLOGS.map((blog) => {
      const publishedAt = blog.publishedDaysAgo === null ? null : daysAgo(blog.publishedDaysAgo);
      const createdAt = publishedAt ? plusMinutes(publishedAt, -120) : daysAgo(2);
      return {
        id: newId(),
        authorId: user(blog.author).id,
        slug: blog.slug,
        category: blog.category,
        title: blog.title,
        excerpt: blog.excerpt,
        image: imageUrl(blog.image, 1200),
        readTime: blog.readTime,
        body: blog.body,
        publishedAt,
        createdAt,
        updatedAt: createdAt,
      };
    }),
  });

  // --- Advertisements -----------------------------------------------------
  const adRows: Prisma.AdvertisementCreateManyInput[] = [];
  for (const ad of ADS) {
    const supplier = user(ad.supplier);
    const id = newId();
    const createdAt = notFuture(latest(plusMinutes(supplier.joinedAt, 60), daysAgo(ad.createdDaysAgo)));
    const live = ad.state === "active" || ad.state === "expired";
    const startDate = live ? latest(plusMinutes(createdAt, 60), daysAgo(ad.startedDaysAgo ?? 0)) : null;
    const expiryDate = startDate ? new Date(startDate.getTime() + ad.durationDays * DAY) : null;
    const status =
      ad.state === "active"
        ? AdStatus.ACTIVE
        : ad.state === "expired"
          ? AdStatus.EXPIRED
          : ad.state === "rejected"
            ? AdStatus.REJECTED
            : AdStatus.PENDING;
    adRows.push({
      id,
      supplierId: supplier.id,
      title: ad.title,
      category: ad.category,
      description: ad.description,
      imageUrl: ad.image ? imageUrl(ad.image) : null,
      price: ad.priceEur === undefined ? null : ad.priceEur * 100,
      contact: ad.contact ?? null,
      location: ad.location ?? null,
      eventDate: ad.event ? new Date(NOW.getTime() + ad.event.inDays * DAY) : null,
      eventTime: ad.event?.time ?? null,
      organizer: ad.event?.organizer ?? null,
      durationDays: ad.durationDays,
      startDate,
      expiryDate,
      status,
      rejectionReason: ad.rejectionReason ?? null,
      views: ad.views ?? 0,
      clicks: ad.clicks ?? 0,
      createdAt,
      updatedAt: startDate ?? createdAt,
    });

    if (startDate) {
      notify(ad.supplier, NotificationType.AD_APPROVED, "Advertisement approved", startDate, {
        subtitle: ad.title,
        link: `/supplier/ads/${id}`,
      });
    }
    if (ad.state === "rejected") {
      notify(ad.supplier, NotificationType.AD_REJECTED, "Advertisement rejected", plusMinutes(createdAt, 600), {
        subtitle: ad.rejectionReason,
        link: `/supplier/ads/${id}`,
      });
    }
    if (ad.state === "active" && expiryDate && expiryDate.getTime() - NOW.getTime() <= 10 * DAY) {
      notify(ad.supplier, NotificationType.AD_EXPIRING, "Advertisement expiring soon", daysAgo(0), {
        subtitle: `${ad.title} expires on ${expiryDate.toISOString().slice(0, 10)}`,
        link: `/supplier/ads/${id}`,
      });
    }
  }
  await tx.advertisement.createMany({ data: adRows });

  // --- Messaging ----------------------------------------------------------
  const conversationRows: Prisma.ConversationCreateManyInput[] = [];
  const participantRows: Prisma.ConversationParticipantCreateManyInput[] = [];
  const messageRows: Prisma.MessageCreateManyInput[] = [];
  for (const convo of CONVERSATIONS) {
    const id = newId();
    const memberIds = convo.members.map((key) => user(key).id);
    const messages = convo.messages.map((m) => ({ ...m, createdAt: minutesAgo(m.minutesAgo) }));
    const firstAt = messages[0].createdAt;
    const lastAt = messages[messages.length - 1].createdAt;

    conversationRows.push({
      id,
      isGroup: Boolean(convo.group),
      name: convo.group?.name ?? null,
      directKey: convo.group ? null : [...memberIds].sort().join(":"),
      createdAt: plusMinutes(firstAt, -1),
      updatedAt: lastAt,
    });

    for (const key of convo.members) {
      let lastReadAt: Date | null = new Date(lastAt.getTime() + 1000);
      if (convo.unreadBy?.includes(key)) {
        // Leave the trailing (up to 2) messages from others unread.
        let unreadStart = messages.length;
        while (unreadStart > 0 && messages.length - unreadStart < 2 && messages[unreadStart - 1].from !== key) {
          unreadStart -= 1;
        }
        lastReadAt = unreadStart > 0 ? new Date(messages[unreadStart - 1].createdAt.getTime() + 1000) : null;

        const latestUnread = messages[messages.length - 1];
        const sender = user(latestUnread.from).person;
        const preview = latestUnread.body || "Sent an attachment";
        notify(
          key,
          convo.group ? NotificationType.GROUP_MESSAGE : NotificationType.MESSAGE,
          convo.group ? `New message in ${convo.group.name}` : `New message from ${nameOf(sender)}`,
          latestUnread.createdAt,
          {
            subtitle: truncate(convo.group ? `${nameOf(sender)}: ${preview}` : preview),
            link: `${messagesPathForRole(user(key).person.role)}${
              convo.group ? `/group/${id}` : `/messages/${user(latestUnread.from).id}`
            }`,
            read: false,
          },
        );
      }
      participantRows.push({
        id: newId(),
        conversationId: id,
        userId: user(key).id,
        role: convo.group?.owner === key ? ConversationRole.OWNER : ConversationRole.MEMBER,
        lastReadAt,
        createdAt: plusMinutes(firstAt, -1),
      });
    }

    for (const message of messages) {
      const attachments = !message.attachment
        ? []
        : message.attachment.kind === "image"
          ? [{ url: imageUrl(message.attachment.image, 1200), name: message.attachment.name, mimeType: "image/jpeg", size: 184_320 }]
          : [
              {
                url: documentUrl(message.attachment.file),
                name: message.attachment.name,
                mimeType: "application/pdf",
                size: docSizes.get(message.attachment.file) ?? 0,
              },
            ];
      messageRows.push({
        id: newId(),
        conversationId: id,
        senderId: user(message.from).id,
        body: message.body,
        attachments,
        createdAt: message.createdAt,
      });
    }
  }
  await tx.conversation.createMany({ data: conversationRows });
  await tx.conversationParticipant.createMany({ data: participantRows });
  await tx.message.createMany({ data: messageRows });

  // --- Reports & moderation ----------------------------------------------
  const reportRows: Prisma.ReportCreateManyInput[] = [];
  const moderationRows: Prisma.ModerationLogCreateManyInput[] = [];
  for (const report of REPORTS) {
    const target = report.target;
    let targetId: string;
    let reportedKey: string;
    let snippet: string;
    let targetType: Prisma.ReportCreateManyInput["targetType"];
    if (target.type === "POST") {
      const post = FEED_POSTS[target.postIndex];
      [targetId, reportedKey, snippet, targetType] = [postIds[target.postIndex], post.author, post.content, "POST"];
    } else if (target.type === "COMMENT") {
      const comment = FEED_POSTS[target.postIndex].comments![target.commentIndex];
      [targetId, reportedKey, snippet, targetType] = [
        commentIdsByPost[target.postIndex][target.commentIndex],
        comment.author,
        comment.content,
        "COMMENT",
      ];
    } else if (target.type === "LISTING") {
      const listing = LISTINGS[target.listingIndex];
      [targetId, reportedKey, snippet, targetType] = [listingIds[target.listingIndex], listing.seller, listing.title, "LISTING"];
    } else if (target.type === "JOB") {
      const job = JOBS[target.jobIndex];
      [targetId, reportedKey, snippet, targetType] = [jobIds[target.jobIndex], job.owner, job.title, "JOB"];
    } else {
      const reported = user(target.user);
      [targetId, reportedKey, snippet, targetType] = [reported.id, target.user, nameOf(reported.person), "USER"];
    }

    const id = newId();
    const createdAt = daysAgo(report.daysAgo);
    const resolvedAt = report.status === "RESOLVED" ? notFuture(plusMinutes(createdAt, 20 * 60)) : null;
    reportRows.push({
      id,
      reporterId: user(report.reporter).id,
      reportedUserId: user(reportedKey).id,
      targetType,
      targetId,
      targetSnippet: truncate(snippet, 1000),
      reason: report.reason,
      reasonDetail: report.reasonDetail ?? null,
      status: report.status as ReportStatus,
      resolvedAt,
      createdAt,
      updatedAt: resolvedAt ?? (report.status === "UNDER_REVIEW" ? notFuture(plusMinutes(createdAt, 240)) : createdAt),
    });

    if (report.action && resolvedAt) {
      moderationRows.push({
        id: newId(),
        reportId: id,
        actorId: user(report.action.by).id,
        targetUserId: user(reportedKey).id,
        action: report.action.action,
        note: report.action.note,
        createdAt: resolvedAt,
      });
      notify(reportedKey, NotificationType.REPORT_UPDATE, "Moderation update", resolvedAt, {
        subtitle: `Action taken on your account: ${report.action.action}`,
      });
    }
  }
  for (const action of ADMIN_ACTIONS) {
    moderationRows.push({
      id: newId(),
      actorId: user(action.by).id,
      targetUserId: user(action.target).id,
      action: action.action,
      note: action.note,
      createdAt: daysAgo(action.daysAgo),
    });
  }
  await tx.report.createMany({ data: reportRows });
  await tx.moderationLog.createMany({ data: moderationRows });

  // --- Notifications & settings ------------------------------------------
  await tx.notification.createMany({ data: notifications });
  await tx.appSetting.createMany({
    data: Object.entries(APP_SETTINGS).map(([key, value]) => ({
      id: newId(),
      key,
      value: value as Prisma.InputJsonValue,
      updatedAt: daysAgo(30),
    })),
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: NODE_ENV is 'production'.");
  }

  const target = describeTarget();
  console.log(`Target database: ${target.label}${target.isLocal ? " (local)" : " (REMOTE)"}`);

  if (RESET && !target.isLocal && !ALLOW_REMOTE) {
    console.error(
      "\nRefusing to reset a non-local database without --allow-remote.\n" +
        "This deletes ALL data in every table. If you are sure, run:\n" +
        "  npm run db:reset -- --allow-remote\n",
    );
    process.exitCode = 1;
    return;
  }

  if (!RESET) {
    const existing = await prisma.user.count();
    if (existing > 0) {
      console.error(
        `\nThe database already contains ${existing} user(s); seeding would create duplicates.\n` +
          "Run `npm run db:reset` to clear it and re-seed.\n",
      );
      process.exitCode = 1;
      return;
    }
  }

  const started = Date.now();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS);
  const docSizes = writeSeedDocuments();

  await prisma.$transaction(
    async (tx) => {
      if (RESET) {
        const cleared = await truncateAll(tx);
        console.log(`Cleared ${cleared} tables (schema and migration history untouched).`);
      }
      await seed(tx, passwordHash, docSizes);
    },
    { maxWait: 20_000, timeout: 180_000 },
  );

  const counts = await prisma.$transaction([
    prisma.user.count(),
    prisma.feedPost.count(),
    prisma.feedComment.count(),
    prisma.listing.count(),
    prisma.job.count(),
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.notification.count(),
    prisma.advertisement.count(),
    prisma.report.count(),
  ]);
  const labels = ["users", "feed posts", "comments", "listings", "jobs", "conversations", "messages", "notifications", "ads", "reports"];
  console.log(`\nSeed complete in ${((Date.now() - started) / 1000).toFixed(1)}s:`);
  console.log(`  ${labels.map((label, i) => `${counts[i]} ${label}`).join(", ")}`);
  console.log(`\nDemo logins (password: ${DEMO_PASSWORD})`);
  for (const key of ["admin", "moderator", "elise", "marcus", "chiara", "hannah", "viktor"]) {
    const p = PEOPLE.find((person) => person.key === key)!;
    const status = p.status && p.status !== UserStatus.ACTIVE ? `, ${p.status}` : "";
    console.log(`  ${p.role.padEnd(8)} ${p.email.padEnd(40)} ${p.firstName} ${p.lastName}${status}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
