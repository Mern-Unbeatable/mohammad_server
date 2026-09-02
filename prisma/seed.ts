import {
  AdCategory,
  AdStatus,
  ListingCategory,
  ListingCondition,
  EmploymentType,
  JobLevel,
  PrismaClient,
  ProfileType,
  Role,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Demo123!";
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);

const initials = (first: string, last: string) =>
  `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS);

  // --- Admin -------------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: process.env.SEED_ADMIN_EMAIL ?? "admin.lab@gmail.com" },
    update: {},
    create: {
      email: process.env.SEED_ADMIN_EMAIL ?? "admin.lab@gmail.com",
      passwordHash,
      role: Role.ADMIN,
      profileType: ProfileType.OTHER,
      profile: {
        create: {
          firstName: "Atik",
          lastName: "Adnan",
          title: "Platform Administrator",
          company: "Lab Unity",
          country: "Belgium",
          initials: initials("Atik", "Adnan"),
        },
      },
      subscription: {
        create: {
          plan: SubscriptionPlan.FREE,
          status: SubscriptionStatus.ACTIVE,
        },
      },
    },
  });

  // --- Demo lab user -----------------------------------------------------
  const user = await prisma.user.upsert({
    where: { email: "user.lab@gmail.com" },
    update: {},
    create: {
      email: "user.lab@gmail.com",
      passwordHash,
      role: Role.USER,
      profileType: ProfileType.LABORATORY,
      profile: {
        create: {
          firstName: "Élise",
          lastName: "Moreau",
          title: "Quality Control Manager",
          company: "Novagen Labs",
          country: "France",
          location: "Lyon, France",
          phone: "+33 4 00 00 00 00",
          about:
            "Quality control leader focused on analytical chemistry and lab operations.",
          initials: initials("Élise", "Moreau"),
          connectionsCount: 128,
        },
      },
      subscription: {
        create: {
          plan: SubscriptionPlan.MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          amount: 1999,
          billingCycle: "Monthly",
          startDate: new Date(),
          trialDaysLeft: 0,
        },
      },
    },
  });

  // --- Demo supplier -----------------------------------------------------
  const supplier = await prisma.user.upsert({
    where: { email: "tradesman.lab@gmail.com" },
    update: {},
    create: {
      email: "tradesman.lab@gmail.com",
      passwordHash,
      role: Role.SUPPLIER,
      profileType: ProfileType.SUPPLIER,
      profile: {
        create: {
          firstName: "Marcus",
          lastName: "Bauer",
          title: "Equipment Supplier",
          company: "BauerLab Instruments",
          country: "Germany",
          location: "Berlin, Germany",
          about:
            "Supplier of certified laboratory instruments and calibration services.",
          initials: initials("Marcus", "Bauer"),
        },
      },
      subscription: {
        create: {
          plan: SubscriptionPlan.FREE,
          status: SubscriptionStatus.ACTIVE,
        },
      },
    },
  });

  // --- Sample content ----------------------------------------------------
  await prisma.feedPost.createMany({
    data: [
      {
        authorId: user.id,
        type: "QUESTION",
        content:
          "Which HPLC column do you recommend for peptide separation under acidic conditions?",
      },
      {
        authorId: supplier.id,
        type: "INFORMATION",
        content:
          "We just released a new line of energy-efficient CO₂ incubators — AMA to learn more.",
      },
    ],
    skipDuplicates: true,
  });

  await prisma.listing.create({
    data: {
      sellerId: user.id,
      title: "Agilent 1260 Infinity II HPLC System",
      description:
        "Well-maintained HPLC system, recently serviced, includes DAD detector.",
      condition: ListingCondition.LIKE_NEW,
      category: ListingCategory.CHROMATOGRAPHY,
      year: 2021,
      price: 1_450_000,
      location: "Lyon, France",
      images: [],
    },
  });

  await prisma.job.create({
    data: {
      ownerId: supplier.id,
      title: "Quality Control Analyst",
      company: "BauerLab Instruments",
      location: "Berlin, Germany",
      employmentType: EmploymentType.FULL_TIME,
      level: JobLevel.MID_LEVEL,
      salary: "€45,000 – €55,000",
      about:
        "Perform QC testing on incoming laboratory instruments and consumables.",
      requirements: [
        "BSc in Chemistry or related field",
        "2+ years QC experience",
        "GMP knowledge",
      ],
    },
  });

  await prisma.advertisement.create({
    data: {
      supplierId: supplier.id,
      title: "New CO₂ Incubator Line — Launch Offer",
      category: AdCategory.PRODUCT,
      description:
        "Energy-efficient incubators with 20% launch discount for the first 50 orders.",
      price: 845_000,
      durationDays: 14,
      status: AdStatus.PENDING,
    },
  });

  await prisma.blog.create({
    data: {
      authorId: admin.id,
      slug: "welcome-to-lab-unity",
      category: "Industry News",
      title: "Welcome to Lab Unity",
      excerpt:
        "The professional network built for laboratories, suppliers and lab professionals.",
      body: "Lab Unity connects laboratories, suppliers and professionals across Europe...",
      readTime: "4 min read",
      publishedAt: new Date(),
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "sponsored_pricing" },
    update: {},
    create: {
      key: "sponsored_pricing",
      value: [
        { id: "7-days", label: "7 Days", price: 35 },
        { id: "14-days", label: "14 Days", price: 60 },
        { id: "30-days", label: "30 Days", price: 100 },
      ],
    },
  });

  // eslint-disable-next-line no-console
  console.log("✅ Seed complete. Demo accounts (password:", DEMO_PASSWORD, ")");
  // eslint-disable-next-line no-console
  console.log(
    "   admin.lab@gmail.com / user.lab@gmail.com / tradesman.lab@gmail.com",
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
