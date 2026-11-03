/**
 * Adds a small batch of dummy data ON TOP of whatever is already in the database.
 * Nothing existing is modified, except connection counts on profiles that gain a dummy connection.
 *
 *   npm run db:seed-extra              add the batch (aborts if it was already added)
 *   npm run db:seed-extra -- --remove  delete every dummy account and everything it created
 *
 * Dummy accounts use the @demo.labunity.test email domain, which is how --remove finds them.
 * They share the password SEED_ADMIN_PASSWORD (default Demo123!).
 * Refuses to run when NODE_ENV=production.
 */
import crypto from "node:crypto";
import {
  ConnectionStatus,
  ConversationRole,
  EmploymentType,
  FeedPostType,
  JobApplicationStatus,
  JobLevel,
  ListingCategory,
  ListingCondition,
  NotificationType,
  Prisma,
  PrismaClient,
  ProfileType,
  ReactionType,
  Role,
  SubscriptionPlan,
  SubscriptionStatus,
  WorkplaceType,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { LAB_IMAGES, portraitUrl, unsplash, type LabImage } from "./seed-data";

dotenv.config();

const prisma = new PrismaClient();
const REMOVE = process.argv.includes("--remove");
const EMAIL_DOMAIN = "demo.labunity.test";
const DEMO_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Demo123!";
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);

const COUNTS = { users: 20, posts: 40, listings: 20, jobs: 15, conversations: 8 };

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

let prngState = 20261023;
const random = (): number => {
  prngState = (prngState + 0x6d2b79f5) | 0;
  let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
const sample = <T>(items: readonly T[], n: number): T[] => {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return out;
};

const NOW = Date.now();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const daysAgo = (days: number): Date => new Date(NOW - days * DAY - Math.floor(random() * 6 * 60 * MINUTE));
const after = (date: Date, minMinutes: number, maxMinutes: number): Date =>
  new Date(Math.min(NOW - MINUTE, date.getTime() + int(minMinutes, maxMinutes) * MINUTE));
const newId = (): string => crypto.randomUUID();
const image = (key: LabImage, width = 1000): string => unsplash(LAB_IMAGES[key], width);

// ---------------------------------------------------------------------------
// Content pools
// ---------------------------------------------------------------------------

const FEMALE = ["Sofia", "Lena", "Amira", "Clara", "Ines", "Maja", "Noor", "Eva", "Yasmin", "Lotte"];
const MALE = ["Lucas", "Omar", "Pieter", "Mateo", "Jonas", "Karim", "Tomas", "Rayan", "Daan", "Felix"];
const LAST = ["Peeters", "Janssens", "Haddad", "Dubois", "Novak", "Rahman", "Vermeulen", "Costa", "Kowalski", "Martens", "Ahmed", "Lambert", "Moreau", "Silva", "De Smet", "Fischer", "Hussain", "Leclercq", "Rossi", "Nielsen"];
const FEMALE_PORTRAITS = ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10"] as const;
const MALE_PORTRAITS = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10"] as const;
const PLACES: [string, string][] = [
  ["Brussels", "Belgium"], ["Antwerp", "Belgium"], ["Ghent", "Belgium"], ["Leuven", "Belgium"], ["Liège", "Belgium"],
  ["Amsterdam", "Netherlands"], ["Rotterdam", "Netherlands"], ["Paris", "France"], ["Lyon", "France"],
  ["Berlin", "Germany"], ["Munich", "Germany"], ["Milan", "Italy"], ["Madrid", "Spain"], ["Lisbon", "Portugal"],
];
const ROLES: { title: string; type: ProfileType; role: Role; companies: string[] }[] = [
  { title: "Clinical Laboratory Scientist", type: ProfileType.LABORATORY, role: Role.USER, companies: ["BioLab Diagnostics", "Synlab Belgium", "Eurofins Clinical"] },
  { title: "QC Analyst", type: ProfileType.LABORATORY, role: Role.USER, companies: ["Pharmacure", "UCB Quality Labs", "NovaChem Analytics"] },
  { title: "Molecular Biologist", type: ProfileType.PROFESSIONAL, role: Role.USER, companies: ["GeneVista", "VIB Research", "Helix Genomics"] },
  { title: "Hospital Lab Manager", type: ProfileType.HOSPITAL, role: Role.USER, companies: ["UZ Leuven", "AZ Sint-Jan", "CHU Liège"] },
  { title: "Microbiologist", type: ProfileType.CLINIC, role: Role.USER, companies: ["MediCare Clinic", "Clinique Saint-Luc", "CityLab Clinic"] },
  { title: "Research Technician", type: ProfileType.PROFESSIONAL, role: Role.USER, companies: ["KU Leuven", "Ghent University", "Sciensano"] },
  { title: "Sales Engineer, Lab Equipment", type: ProfileType.SUPPLIER, role: Role.SUPPLIER, companies: ["LabEquip Benelux", "Sartorius Partner BE", "SpectraTech Supply"] },
  { title: "Product Specialist", type: ProfileType.SUPPLIER, role: Role.SUPPLIER, companies: ["ChromaParts", "CellCulture Direct", "SafeLab Consumables"] },
];

const POSTS: { type: FeedPostType; content: string; image?: LabImage }[] = [
  { type: FeedPostType.QUESTION, content: "Which LIMS are you using in a mid-sized clinical lab? We're evaluating options and would love honest feedback." },
  { type: FeedPostType.QUESTION, content: "Has anyone validated a new HPLC column chemistry recently? Looking for tips on keeping the validation lean but audit-proof." },
  { type: FeedPostType.QUESTION, content: "Best practices for -80 °C freezer monitoring? We had an alarm at 3 a.m. last week and nobody got notified.", image: "testTubes" },
  { type: FeedPostType.QUESTION, content: "How do you train new technicians on biosafety cabinet use? Any good checklists to share?" },
  { type: FeedPostType.QUESTION, content: "Looking for recommendations on a benchtop centrifuge for a small microbiology lab — budget around €6k." },
  { type: FeedPostType.INFORMATION, content: "Our team just passed its ISO 15189 re-accreditation with zero major findings. Proud of everyone involved!", image: "labTeam" },
  { type: FeedPostType.INFORMATION, content: "Sharing a quick tip: label your aliquots with both date and freeze-thaw count. Saved us a lot of confusion this quarter.", image: "pipetteVial" },
  { type: FeedPostType.INFORMATION, content: "New paper out on rapid PCR workflows for respiratory panels — happy to send the PDF to anyone interested.", image: "dna" },
  { type: FeedPostType.INFORMATION, content: "Reminder: EQA submissions for Q4 close next Friday. Don't leave it to the last day!" },
  { type: FeedPostType.INFORMATION, content: "We switched to reusable glass pipettes for non-sterile work and cut plastic waste by 30% in three months.", image: "glassware" },
  { type: FeedPostType.INFORMATION, content: "Great turnout at the Brussels lab automation meetup yesterday. Slides will be shared here soon.", image: "labBenches" },
  { type: FeedPostType.INFORMATION, content: "Our microscopy core now offers open slots on Thursdays for external researchers.", image: "microscopeScientist" },
  { type: FeedPostType.SUPPLIERS, content: "Demo units of our new compact spectrophotometer are available for two-week trials across Benelux.", image: "analyser" },
  { type: FeedPostType.SUPPLIERS, content: "End-of-year offer on nitrile gloves and filter tips — bulk pricing for labs ordering before December.", image: "beakers" },
  { type: FeedPostType.SUPPLIERS, content: "We now offer on-site calibration for balances and pipettes in Flanders and Wallonia.", image: "instrumentBench" },
];
const COMMENTS = [
  "Great question — following this thread.",
  "We had the same issue last year; happy to share our SOP.",
  "Thanks for sharing, very useful!",
  "Congratulations to the whole team!",
  "Could you DM me more details?",
  "We use a similar setup and it works well.",
  "Interesting — what was the biggest challenge?",
  "Would love to see the slides when they're available.",
];

const LISTINGS: { title: string; category: ListingCategory; images: LabImage[]; min: number; max: number }[] = [
  { title: "Agilent 1100 HPLC system with autosampler", category: ListingCategory.CHROMATOGRAPHY, images: ["instrumentBench"], min: 6000, max: 14000 },
  { title: "Shimadzu GC-2010 gas chromatograph", category: ListingCategory.CHROMATOGRAPHY, images: ["analyser"], min: 5000, max: 11000 },
  { title: "Thermo NanoDrop One spectrophotometer", category: ListingCategory.SPECTROSCOPY, images: ["analyser"], min: 3500, max: 7000 },
  { title: "UV-Vis double-beam spectrophotometer", category: ListingCategory.SPECTROSCOPY, images: ["instrumentBench"], min: 2000, max: 5000 },
  { title: "CO2 incubator, 170 L, HEPA filtered", category: ListingCategory.INCUBATION, images: ["cells"], min: 2500, max: 6000 },
  { title: "Shaking incubator with orbital platform", category: ListingCategory.INCUBATION, images: ["flask"], min: 1800, max: 4500 },
  { title: "Eppendorf 5810R refrigerated centrifuge", category: ListingCategory.CENTRIFUGATION, images: ["testTubes"], min: 3000, max: 7500 },
  { title: "Microcentrifuge, 24-place rotor", category: ListingCategory.CENTRIFUGATION, images: ["pipetteVial"], min: 400, max: 1200 },
  { title: "Analytical balance 220 g / 0.1 mg", category: ListingCategory.WEIGHING, images: ["beakers"], min: 800, max: 2200 },
  { title: "Precision top-loading balance 3 kg", category: ListingCategory.WEIGHING, images: ["glassware"], min: 300, max: 900 },
  { title: "Class II biosafety cabinet, 1.2 m", category: ListingCategory.SAFETY, images: ["goggles"], min: 2500, max: 6500 },
  { title: "Chemical fume hood, ducted, 1.5 m", category: ListingCategory.SAFETY, images: ["labBenches"], min: 1500, max: 4000 },
  { title: "Box of 10 x 96 filter tip racks (200 µL)", category: ListingCategory.CONSUMABLES, images: ["pipettePlate"], min: 60, max: 180 },
  { title: "Cryovials 2 mL, 500 pcs, sterile", category: ListingCategory.CONSUMABLES, images: ["sampleTray"], min: 40, max: 120 },
  { title: "Olympus CX43 upright microscope", category: ListingCategory.MICROSCOPY, images: ["microscope"], min: 1500, max: 3500 },
  { title: "Inverted fluorescence microscope with camera", category: ListingCategory.MICROSCOPY, images: ["microscopeRow"], min: 6000, max: 15000 },
  { title: "Magnetic stirrer hotplate, set of 3", category: ListingCategory.OTHER, images: ["flask"], min: 200, max: 600 },
  { title: "Laboratory water purification system", category: ListingCategory.OTHER, images: ["glassware"], min: 1200, max: 3500 },
];
const CONDITIONS = [ListingCondition.LIKE_NEW, ListingCondition.GOOD, ListingCondition.GOOD, ListingCondition.REFURBISHED, ListingCondition.NEW];

const JOBS: { title: string; level: JobLevel; image: LabImage; about: string; requirements: string[] }[] = [
  { title: "Medical Laboratory Technologist", level: JobLevel.MID_LEVEL, image: "labBenches", about: "Join our routine diagnostics team running haematology and clinical chemistry analysers in a 24/7 hospital lab.", requirements: ["Bachelor in Biomedical Laboratory Technology", "2+ years in a clinical lab", "Dutch or French, English a plus"] },
  { title: "QC Chemist (HPLC)", level: JobLevel.MID_LEVEL, image: "instrumentBench", about: "Perform release and stability testing for oral solid dosage forms under GMP.", requirements: ["Hands-on HPLC/UPLC experience", "GMP documentation", "Empower or Chromeleon"] },
  { title: "Junior Research Technician — Cell Culture", level: JobLevel.ENTRY_LEVEL, image: "cells", about: "Support our cell biology group with culture maintenance, assays and inventory.", requirements: ["Degree in biology or related field", "Aseptic technique", "Eager to learn"] },
  { title: "Senior Microbiologist", level: JobLevel.SENIOR, image: "microscopeScientist", about: "Lead the microbiology section and drive method validation and ISO 15189 compliance.", requirements: ["5+ years clinical microbiology", "Team leadership", "MALDI-TOF experience"] },
  { title: "Laboratory Quality Officer", level: JobLevel.MID_LEVEL, image: "goggles", about: "Own the quality management system, audits and CAPA follow-up for a multi-site lab.", requirements: ["ISO 15189 or ISO 17025", "Audit experience", "Strong writing skills"] },
  { title: "Molecular Diagnostics Scientist", level: JobLevel.SENIOR, image: "dna", about: "Develop and validate PCR and NGS assays for oncology and infectious disease panels.", requirements: ["PhD or MSc in molecular biology", "qPCR and NGS", "Assay validation"] },
  { title: "Lab Equipment Field Service Engineer", level: JobLevel.MID_LEVEL, image: "engineer", about: "Install, maintain and repair analytical instruments for customers across Benelux.", requirements: ["Technical degree", "Driving licence", "Customer-facing attitude"] },
  { title: "Biobank Technician", level: JobLevel.ENTRY_LEVEL, image: "testTubes", about: "Process, store and track human samples in our ISO-certified biobank.", requirements: ["Lab technician diploma", "Attention to detail", "LIMS experience is a plus"] },
  { title: "Point-of-Care Testing Coordinator", level: JobLevel.MID_LEVEL, image: "hospital", about: "Coordinate POCT devices, training and quality control across hospital wards.", requirements: ["Clinical lab background", "Training skills", "Organised and proactive"] },
  { title: "Lab Automation Specialist", level: JobLevel.SENIOR, image: "analyser", about: "Design and optimise automated liquid-handling workflows for high-throughput screening.", requirements: ["Hamilton or Tecan scripting", "Python is a plus", "3+ years automation"] },
];
const SALARIES = ["€2,800 – €3,400", "€3,200 – €4,000", "€3,800 – €4,800", "€4,500 – €5,800", null];
const COVER_LETTERS = [
  "I'd love to bring my lab experience to your team — happy to discuss in more detail.",
  "Your role matches my background closely; please find my profile attached.",
  null,
];

const CHAT_LINES = [
  "Hi! Saw your post — do you have a minute to talk?",
  "Sure, what would you like to know?",
  "Is the equipment still available?",
  "Yes, it is. Happy to arrange a viewing next week.",
  "Great, Tuesday afternoon works for me.",
  "Perfect, I'll send the address.",
  "Thanks for connecting!",
  "Likewise — let's keep in touch.",
];

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

async function add(tx: Prisma.TransactionClient, passwordHash: string) {
  // Existing members the dummy users interact with (never modified, except connection counts).
  const existing = await tx.user.findMany({
    where: { status: "ACTIVE", role: { not: Role.ADMIN }, NOT: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
    select: { id: true },
  });
  const existingIds = existing.map((u) => u.id);
  const existingPostIds = (await tx.feedPost.findMany({ select: { id: true }, orderBy: { createdAt: "desc" }, take: 30 })).map((p) => p.id);

  // --- Users ---------------------------------------------------------------
  const users = Array.from({ length: COUNTS.users }, (_, i) => {
    const female = i % 2 === 0;
    const firstName = (female ? FEMALE : MALE)[Math.floor(i / 2) % 10];
    const lastName = LAST[i % LAST.length];
    const role = ROLES[i % ROLES.length];
    const [city, country] = pick(PLACES);
    return {
      id: newId(),
      firstName,
      lastName,
      email: `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "") + `@${EMAIL_DOMAIN}`,
      role,
      city,
      country,
      avatar: (female ? FEMALE_PORTRAITS : MALE_PORTRAITS)[i % 10],
      joinedAt: daysAgo(int(5, 120)),
    };
  });
  const userIds = users.map((u) => u.id);

  await tx.user.createMany({
    data: users.map((u) => ({
      id: u.id,
      email: u.email,
      passwordHash,
      role: u.role.role,
      profileType: u.role.type,
      lastLoginAt: after(u.joinedAt, 60, 60 * 24 * 30),
      createdAt: u.joinedAt,
      updatedAt: u.joinedAt,
    })),
  });
  await tx.profile.createMany({
    data: users.map((u) => ({
      userId: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      title: u.role.title,
      company: pick(u.role.companies),
      country: u.country,
      location: `${u.city}, ${u.country}`,
      about: `${u.role.title} based in ${u.city}. Interested in lab quality, automation and sharing practical know-how.`,
      avatarUrl: portraitUrl(u.avatar),
      coverUrl: image(pick(Object.keys(LAB_IMAGES) as LabImage[]), 1600),
      initials: `${u.firstName[0]}${u.lastName[0]}`.toUpperCase(),
      createdAt: u.joinedAt,
      updatedAt: u.joinedAt,
    })),
  });
  await tx.subscription.createMany({
    data: users.map((u, i) =>
      i % 4 === 0
        ? { userId: u.id, plan: SubscriptionPlan.MONTHLY, status: SubscriptionStatus.ACTIVE, amount: 1999, billingCycle: "Monthly", startDate: u.joinedAt, paymentMethod: "Card", createdAt: u.joinedAt }
        : { userId: u.id, plan: SubscriptionPlan.FREE, status: SubscriptionStatus.TRIAL, startDate: u.joinedAt, trialDaysLeft: Math.max(0, 90 - Math.round((NOW - u.joinedAt.getTime()) / DAY)), createdAt: u.joinedAt },
    ),
  });

  // --- Connections ---------------------------------------------------------
  const pairs = new Set<string>();
  const connections: Prisma.ConnectionCreateManyInput[] = [];
  const connect = (a: string, b: string, status: ConnectionStatus) => {
    const key = [a, b].sort().join(":");
    if (a === b || pairs.has(key)) return;
    pairs.add(key);
    const createdAt = daysAgo(int(1, 60));
    connections.push({ id: newId(), requesterId: a, addresseeId: b, status, createdAt, updatedAt: createdAt });
  };
  for (const id of userIds) {
    for (const other of sample(userIds, 3)) connect(id, other, ConnectionStatus.ACCEPTED);
    for (const other of sample(existingIds, 2)) connect(id, other, random() < 0.75 ? ConnectionStatus.ACCEPTED : ConnectionStatus.PENDING);
  }
  await tx.connection.createMany({ data: connections });

  // --- Feed posts, reactions, comments --------------------------------------
  const reactionTypes = [ReactionType.like, ReactionType.like, ReactionType.love, ReactionType.wow, ReactionType.haha];
  const posts: Prisma.FeedPostCreateManyInput[] = [];
  const reactions: Prisma.FeedReactionCreateManyInput[] = [];
  const comments: Prisma.FeedCommentCreateManyInput[] = [];
  for (let i = 0; i < COUNTS.posts; i++) {
    const template = POSTS[i % POSTS.length];
    const author = users[i % users.length];
    const createdAt = after(author.joinedAt, 60, 60 * 24 * 60);
    const id = newId();
    posts.push({
      id,
      authorId: author.id,
      type: template.type,
      content: template.content,
      imageUrl: template.image ? image(template.image) : null,
      imageUrls: template.image ? [image(template.image)] : [],
      createdAt,
      updatedAt: createdAt,
    });
    for (const reactor of sample([...userIds, ...existingIds].filter((u) => u !== author.id), int(0, 8))) {
      reactions.push({ id: newId(), postId: id, userId: reactor, type: pick(reactionTypes), createdAt: after(createdAt, 5, 600) });
    }
    for (const commenter of sample(userIds.filter((u) => u !== author.id), int(0, 3))) {
      comments.push({ id: newId(), postId: id, authorId: commenter, content: pick(COMMENTS), createdAt: after(createdAt, 10, 900) });
    }
  }
  // A little activity on existing posts too.
  for (const postId of sample(existingPostIds, 10)) {
    for (const reactor of sample(userIds, int(1, 4))) {
      reactions.push({ id: newId(), postId, userId: reactor, type: pick(reactionTypes), createdAt: daysAgo(int(0, 10)) });
    }
  }
  await tx.feedPost.createMany({ data: posts });
  await tx.feedReaction.createMany({ data: reactions, skipDuplicates: true });
  await tx.feedComment.createMany({ data: comments });

  // --- Marketplace ---------------------------------------------------------
  const listings: Prisma.ListingCreateManyInput[] = [];
  const saved: Prisma.SavedListingCreateManyInput[] = [];
  for (let i = 0; i < COUNTS.listings; i++) {
    const template = LISTINGS[i % LISTINGS.length];
    const seller = users[(i * 3) % users.length];
    const createdAt = after(seller.joinedAt, 60, 60 * 24 * 45);
    const id = newId();
    listings.push({
      id,
      sellerId: seller.id,
      title: template.title,
      description: `${template.title}. Well maintained, service history available. Pick-up in ${seller.city} or shipping on request.`,
      condition: pick(CONDITIONS),
      year: int(2012, 2024),
      price: Math.round(int(template.min, template.max) / 10) * 10 * 100,
      category: template.category,
      location: `${seller.city}, ${seller.country}`,
      images: template.images.map((key) => image(key)),
      status: i % 9 === 8 ? "SOLD" : "ACTIVE",
      createdAt,
      updatedAt: createdAt,
    });
    for (const saver of sample([...userIds, ...existingIds].filter((u) => u !== seller.id), int(0, 3))) {
      saved.push({ id: newId(), userId: saver, listingId: id, createdAt: after(createdAt, 30, 2000) });
    }
  }
  await tx.listing.createMany({ data: listings });
  await tx.savedListing.createMany({ data: saved, skipDuplicates: true });

  // --- Recruitment ---------------------------------------------------------
  const employment = [EmploymentType.FULL_TIME, EmploymentType.FULL_TIME, EmploymentType.PART_TIME, EmploymentType.CONTRACT, EmploymentType.INTERNSHIP];
  const workplace = [WorkplaceType.ON_SITE, WorkplaceType.ON_SITE, WorkplaceType.HYBRID, WorkplaceType.REMOTE];
  const appStatuses = [JobApplicationStatus.APPLIED, JobApplicationStatus.APPLIED, JobApplicationStatus.REVIEWED, JobApplicationStatus.ACCEPTED, JobApplicationStatus.REJECTED];
  const jobs: Prisma.JobCreateManyInput[] = [];
  const applications: Prisma.JobApplicationCreateManyInput[] = [];
  const notifications: Prisma.NotificationCreateManyInput[] = [];
  for (let i = 0; i < COUNTS.jobs; i++) {
    const template = JOBS[i % JOBS.length];
    const owner = users[(i * 7) % users.length];
    const createdAt = after(owner.joinedAt, 60, 60 * 24 * 40);
    const id = newId();
    jobs.push({
      id,
      ownerId: owner.id,
      title: template.title,
      company: pick(owner.role.companies),
      location: `${owner.city}, ${owner.country}`,
      employmentType: pick(employment),
      workplaceType: pick(workplace),
      level: template.level,
      salary: pick(SALARIES),
      imageUrl: image(template.image),
      about: template.about,
      requirements: template.requirements,
      status: i % 6 === 5 ? "CLOSED" : "OPEN",
      createdAt,
      updatedAt: createdAt,
    });
    for (const applicant of sample(users.filter((u) => u.id !== owner.id), int(0, 4))) {
      const at = after(createdAt, 120, 60 * 24 * 10);
      applications.push({ id: newId(), jobId: id, applicantId: applicant.id, coverLetter: pick(COVER_LETTERS), status: pick(appStatuses), createdAt: at });
      notifications.push({
        id: newId(),
        userId: owner.id,
        type: NotificationType.JOB_APPLICATION,
        title: "New job application",
        subtitle: `${applicant.firstName} ${applicant.lastName} applied to ${template.title}`,
        link: `/recruitment/${id}`,
        read: random() < 0.5,
        createdAt: at,
      });
    }
  }
  await tx.job.createMany({ data: jobs });
  await tx.jobApplication.createMany({ data: applications });

  // --- Direct conversations between dummy users ---------------------------
  const conversations: Prisma.ConversationCreateManyInput[] = [];
  const participants: Prisma.ConversationParticipantCreateManyInput[] = [];
  const messages: Prisma.MessageCreateManyInput[] = [];
  for (let i = 0; i < COUNTS.conversations; i++) {
    const a = users[i * 2];
    const b = users[i * 2 + 1];
    const id = newId();
    let at = daysAgo(int(1, 20));
    const startedAt = at;
    const lines = CHAT_LINES.slice(0, int(3, CHAT_LINES.length));
    for (const [n, body] of lines.entries()) {
      at = after(at, 2, 240);
      messages.push({ id: newId(), conversationId: id, senderId: n % 2 === 0 ? a.id : b.id, body, createdAt: at });
    }
    conversations.push({ id, isGroup: false, directKey: [a.id, b.id].sort().join(":"), createdAt: startedAt, updatedAt: at });
    participants.push(
      { id: newId(), conversationId: id, userId: a.id, role: ConversationRole.MEMBER, lastReadAt: new Date(at.getTime() + 1000), createdAt: startedAt },
      { id: newId(), conversationId: id, userId: b.id, role: ConversationRole.MEMBER, lastReadAt: i % 3 === 0 ? null : new Date(at.getTime() + 1000), createdAt: startedAt },
    );
  }
  await tx.conversation.createMany({ data: conversations });
  await tx.conversationParticipant.createMany({ data: participants });
  await tx.message.createMany({ data: messages });

  // --- Welcome notifications ---------------------------------------------
  for (const u of users) {
    notifications.push({
      id: newId(),
      userId: u.id,
      type: NotificationType.SYSTEM,
      title: "Welcome to Lab Unity",
      subtitle: "Complete your profile to get discovered by labs and suppliers.",
      link: u.role.role === Role.SUPPLIER ? "/supplier/profile" : "/profile",
      read: true,
      createdAt: after(u.joinedAt, 1, 2),
    });
  }
  await tx.notification.createMany({ data: notifications });

  await recountConnections(tx);

  return {
    users: users.length,
    connections: connections.length,
    posts: posts.length,
    reactions: reactions.length,
    comments: comments.length,
    listings: listings.length,
    savedListings: saved.length,
    jobs: jobs.length,
    applications: applications.length,
    conversations: conversations.length,
    messages: messages.length,
    notifications: notifications.length,
  };
}

/** Keeps Profile.connectionsCount equal to the number of accepted connections. */
async function recountConnections(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`
    UPDATE "Profile" p SET "connectionsCount" = sub.n
    FROM (
      SELECT u.id, COUNT(c.id)::int AS n
      FROM "User" u
      LEFT JOIN "Connection" c
        ON c.status = 'ACCEPTED' AND (c."requesterId" = u.id OR c."addresseeId" = u.id)
      GROUP BY u.id
    ) sub
    WHERE p."userId" = sub.id AND p."connectionsCount" <> sub.n`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run: NODE_ENV is 'production'.");
  const url = new URL(process.env.DATABASE_URL ?? "");
  console.log(`Target database: ${url.hostname}:${url.port || "5432"}${url.pathname}`);

  const dummyWhere = { email: { endsWith: `@${EMAIL_DOMAIN}` } };
  const already = await prisma.user.count({ where: dummyWhere });

  if (REMOVE) {
    const result = await prisma.$transaction(async (tx) => {
      const ids = (await tx.user.findMany({ where: dummyWhere, select: { id: true } })).map((u) => u.id);
      const emptied = await tx.conversation.deleteMany({
        where: { participants: { every: { userId: { in: ids } } } },
      });
      const deleted = await tx.user.deleteMany({ where: { id: { in: ids } } });
      await recountConnections(tx);
      return { users: deleted.count, conversations: emptied.count };
    });
    console.log(`Removed ${result.users} dummy users (and everything they created) and ${result.conversations} conversations.`);
    return;
  }

  if (already > 0) {
    console.error(`\nDummy data is already present (${already} users @${EMAIL_DOMAIN}). Run with -- --remove first to re-create it.\n`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS);
  const summary = await prisma.$transaction((tx) => add(tx, passwordHash), { maxWait: 20_000, timeout: 120_000 });
  console.log("\nAdded:", Object.entries(summary).map(([k, v]) => `${v} ${k}`).join(", "));
  console.log(`\nDummy logins use the @${EMAIL_DOMAIN} domain with password ${DEMO_PASSWORD}, e.g. sofia.peeters@${EMAIL_DOMAIN}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
