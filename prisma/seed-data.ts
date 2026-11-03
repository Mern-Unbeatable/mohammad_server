/**
 * Static content for prisma/seed.ts. Everything here is fictional.
 * Non-demo accounts use the reserved `.example` TLD so no real inbox can
 * ever receive mail (e.g. password reset links) from seeded data.
 */
import {
  AdCategory,
  EmploymentType,
  FeedPostType,
  GeneralPostType,
  JobLevel,
  ListingCategory,
  ListingCondition,
  ProfileType,
  Role,
  UserStatus,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Images (Unsplash CDN, verified reachable) and helpers
// ---------------------------------------------------------------------------

export const unsplash = (id: string, width = 800): string =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=80`;

export const LAB_IMAGES = {
  pipettePlate: "1532187863486-abf9dbad1b69",
  labTeam: "1581093450021-4a7360e9a6b5",
  cells: "1576086213369-97a306d36557",
  labBenches: "1579154204601-01588f351e67",
  microscopeScientist: "1582719471384-894fbb16e074",
  dna: "1628595351029-c2bf17511435",
  goggles: "1581093588401-fbb62a02f120",
  testTubes: "1614935151651-0bea6508db6b",
  microscopeRow: "1518152006812-edab29b069ac",
  funding: "1567427017947-545c5f8d16ad",
  instrumentBench: "1583912086096-8c60d75a53f9",
  pills: "1631549916768-4119b2e5f926",
  glassware: "1576671081837-49000212a370",
  microscope: "1614308457932-e16d85c5d053",
  radiology: "1581595219315-a187dd40c322",
  flask: "1554475901-4538ddfbccc2",
  beakers: "1532094349884-543bc11b234d",
  analyser: "1581091226825-a6a2a5aee158",
  engineer: "1581093804475-577d72e38aa0",
  pipetteVial: "1579165466741-7f35e4755660",
  capsules: "1587854692152-cbe660dbde88",
  sampleTray: "1563213126-a4273aed2016",
  operatingRoom: "1516549655169-df83a0774514",
  stethoscope: "1576091160550-2173dba999ef",
  hospital: "1586773860418-d37222d8fce3",
} as const;

export type LabImage = keyof typeof LAB_IMAGES;

const PORTRAITS = {
  f1: "1494790108377-be9c29b29330",
  f2: "1438761681033-6461ffad8d80",
  f3: "1544005313-94ddf0286df2",
  f4: "1517841905240-472988babdf9",
  f5: "1534528741775-53994a69daeb",
  f6: "1531123897727-8f129e1688ce",
  f7: "1573496359142-b8d87734a5a2",
  f8: "1580489944761-15a19d654956",
  f9: "1573497019940-1c28c88b4f3e",
  f10: "1508214751196-bcfd4ca60f91",
  m1: "1507003211169-0a1dd7228f2d",
  m2: "1500648767791-00dcc994a43e",
  m3: "1472099645785-5658abf4ff4e",
  m4: "1506794778202-cad84cf45f1d",
  m5: "1560250097-0b93528c311a",
  m6: "1519085360753-af0119f7cbe7",
  m7: "1557862921-37829c790f19",
  m8: "1566492031773-4f4e44671857",
  m9: "1527980965255-d3b416303d12",
  m10: "1552058544-f2b08422138a",
} as const;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** Subscription scenario; the seed turns each into consistent dates/amounts. */
export type SubscriptionScenario =
  | { kind: "free" }
  | { kind: "trial"; startedDaysAgo: number }
  | { kind: "trialExpired" }
  | { kind: "monthly"; startedDaysAgo: number }
  | { kind: "yearly"; startedDaysAgo: number }
  | { kind: "cancelled"; startedDaysAgo: number }
  | { kind: "lapsed" };

export interface SeedPerson {
  key: string;
  email: string;
  role: Role;
  profileType: ProfileType;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  country: string;
  city: string;
  phone?: string;
  about: string;
  aboutExtended?: string;
  avatar?: keyof typeof PORTRAITS;
  cover?: LabImage;
  status?: UserStatus;
  warnings?: number;
  subscription: SubscriptionScenario;
  joinedDaysAgo: number;
  lastLoginDaysAgo?: number;
}

export const portraitUrl = (key: keyof typeof PORTRAITS): string =>
  unsplash(PORTRAITS[key], 400);

export const PEOPLE: SeedPerson[] = [
  // --- Admins -------------------------------------------------------------
  {
    key: "admin",
    email: process.env.SEED_ADMIN_EMAIL ?? "admin.lab@gmail.com",
    role: Role.ADMIN,
    profileType: ProfileType.OTHER,
    firstName: "Atik",
    lastName: "Adnan",
    title: "Platform Administrator",
    company: "Lab Unity",
    country: "Belgium",
    city: "Brussels",
    about: "Runs day-to-day operations of the Lab Unity network.",
    avatar: "m5",
    subscription: { kind: "free" },
    joinedDaysAgo: 265,
    lastLoginDaysAgo: 0,
  },
  {
    key: "moderator",
    email: "claire.dubois@labunity.example",
    role: Role.ADMIN,
    profileType: ProfileType.OTHER,
    firstName: "Claire",
    lastName: "Dubois",
    title: "Trust & Safety Moderator",
    company: "Lab Unity",
    country: "Belgium",
    city: "Brussels",
    about: "Keeps the community safe: reviews reports, ads and flagged content.",
    avatar: "f7",
    subscription: { kind: "free" },
    joinedDaysAgo: 240,
    lastLoginDaysAgo: 1,
  },

  // --- Demo accounts (kept from the original seed) -------------------------
  {
    key: "elise",
    email: "user.lab@gmail.com",
    role: Role.USER,
    profileType: ProfileType.LABORATORY,
    firstName: "Élise",
    lastName: "Moreau",
    title: "Quality Control Manager",
    company: "Novagen Labs",
    country: "France",
    city: "Lyon",
    phone: "+33 4 72 00 18 40",
    about: "Quality control leader focused on analytical chemistry and lab operations.",
    aboutExtended:
      "12 years in pharmaceutical QC. I lead a team of 14 analysts running HPLC, GC and dissolution testing under GMP, and I am currently rolling out a LIMS migration across two sites.",
    avatar: "f1",
    cover: "labBenches",
    subscription: { kind: "monthly", startedDaysAgo: 12 },
    joinedDaysAgo: 250,
    lastLoginDaysAgo: 0,
  },
  {
    key: "marcus",
    email: "tradesman.lab@gmail.com",
    role: Role.SUPPLIER,
    profileType: ProfileType.SUPPLIER,
    firstName: "Marcus",
    lastName: "Bauer",
    title: "Sales Director",
    company: "BauerLab Instruments",
    country: "Germany",
    city: "Berlin",
    phone: "+49 30 5557 2210",
    about: "Supplier of certified laboratory instruments and calibration services.",
    aboutExtended:
      "BauerLab supplies new and refurbished chromatography, spectroscopy and incubation equipment with a 12-month warranty and on-site installation across the DACH region.",
    avatar: "m1",
    cover: "instrumentBench",
    subscription: { kind: "yearly", startedDaysAgo: 150 },
    joinedDaysAgo: 248,
    lastLoginDaysAgo: 0,
  },

  // --- Users ---------------------------------------------------------------
  {
    key: "sofia",
    email: "sofia.rossi@biomedica.example",
    role: Role.USER,
    profileType: ProfileType.LABORATORY,
    firstName: "Sofia",
    lastName: "Rossi",
    title: "Senior Research Scientist",
    company: "BioMedica Research",
    country: "Italy",
    city: "Milan",
    about: "Cell biologist working on 3D tissue models for drug screening.",
    avatar: "f2",
    cover: "cells",
    subscription: { kind: "yearly", startedDaysAgo: 200 },
    joinedDaysAgo: 230,
    lastLoginDaysAgo: 2,
  },
  {
    key: "lukas",
    email: "lukas.novak@pragueclinic.example",
    role: Role.USER,
    profileType: ProfileType.CLINIC,
    firstName: "Lukáš",
    lastName: "Novák",
    title: "Clinical Laboratory Scientist",
    company: "Prague Central Clinic",
    country: "Czech Republic",
    city: "Prague",
    about: "Haematology and coagulation testing in a busy outpatient clinic.",
    avatar: "m2",
    subscription: { kind: "trial", startedDaysAgo: 20 },
    joinedDaysAgo: 20,
    lastLoginDaysAgo: 1,
  },
  {
    key: "anna",
    email: "anna.kowalska@warsawhospital.example",
    role: Role.USER,
    profileType: ProfileType.HOSPITAL,
    firstName: "Anna",
    lastName: "Kowalska",
    title: "Head of Clinical Microbiology",
    company: "Warsaw University Hospital",
    country: "Poland",
    city: "Warsaw",
    about: "Leading AMR surveillance and rapid diagnostics in a 1,200-bed hospital.",
    avatar: "f3",
    cover: "hospital",
    subscription: { kind: "monthly", startedDaysAgo: 3 },
    joinedDaysAgo: 180,
    lastLoginDaysAgo: 0,
  },
  {
    key: "pieter",
    email: "pieter.devries@amstelgen.example",
    role: Role.USER,
    profileType: ProfileType.LABORATORY,
    firstName: "Pieter",
    lastName: "de Vries",
    title: "Molecular Biologist",
    company: "AmstelGen",
    country: "Netherlands",
    city: "Amsterdam",
    about: "qPCR and NGS library prep for oncology panels.",
    avatar: "m4",
    subscription: { kind: "trial", startedDaysAgo: 60 },
    joinedDaysAgo: 60,
    lastLoginDaysAgo: 4,
  },
  {
    key: "isabel",
    email: "isabel.garcia@iberlab.example",
    role: Role.USER,
    profileType: ProfileType.LABORATORY,
    firstName: "Isabel",
    lastName: "García",
    title: "Laboratory Manager",
    company: "IberLab Diagnostics",
    country: "Spain",
    city: "Madrid",
    about: "Managing a 30-person diagnostics lab; ISO 15189 accredited.",
    avatar: "f4",
    subscription: { kind: "cancelled", startedDaysAgo: 20 },
    joinedDaysAgo: 160,
    lastLoginDaysAgo: 6,
  },
  {
    key: "johan",
    email: "johan.lindqvist@nordicpath.example",
    role: Role.USER,
    profileType: ProfileType.HOSPITAL,
    firstName: "Johan",
    lastName: "Lindqvist",
    title: "Consultant Pathologist",
    company: "Nordic Pathology Centre",
    country: "Sweden",
    city: "Stockholm",
    about: "Digital pathology advocate. Histopathology and cytology.",
    avatar: "m3",
    subscription: { kind: "yearly", startedDaysAgo: 90 },
    joinedDaysAgo: 140,
    lastLoginDaysAgo: 3,
  },
  {
    key: "mariam",
    email: "mariam.haddad@mail.example",
    role: Role.USER,
    profileType: ProfileType.PROFESSIONAL,
    firstName: "Mariam",
    lastName: "Haddad",
    title: "Freelance QA Consultant (ISO 17025)",
    company: "Independent",
    country: "Belgium",
    city: "Ghent",
    about: "Helping small labs get and stay accredited.",
    avatar: "f5",
    subscription: { kind: "monthly", startedDaysAgo: 25 },
    joinedDaysAgo: 120,
    lastLoginDaysAgo: 1,
  },
  {
    key: "thomas",
    email: "thomas.keller@alpinapharma.example",
    role: Role.USER,
    profileType: ProfileType.LABORATORY,
    firstName: "Thomas",
    lastName: "Keller",
    title: "Analytical Chemist",
    company: "Alpina Pharma",
    country: "Switzerland",
    city: "Basel",
    about: "Method development and validation for small-molecule APIs.",
    subscription: { kind: "trialExpired" },
    joinedDaysAgo: 110,
    lastLoginDaysAgo: 15,
  },
  {
    key: "chiara",
    email: "chiara.bianchi@unibo.example",
    role: Role.USER,
    profileType: ProfileType.PROFESSIONAL,
    firstName: "Chiara",
    lastName: "Bianchi",
    title: "PhD Candidate, Biochemistry",
    company: "University of Bologna",
    country: "Italy",
    city: "Bologna",
    about: "Protein purification and enzyme kinetics. Looking for my first industry role.",
    avatar: "f6",
    subscription: { kind: "trial", startedDaysAgo: 5 },
    joinedDaysAgo: 5,
    lastLoginDaysAgo: 0,
  },
  {
    key: "oliver",
    email: "oliver.hughes@thamesclinic.example",
    role: Role.USER,
    profileType: ProfileType.CLINIC,
    firstName: "Oliver",
    lastName: "Hughes",
    title: "Clinic Operations Lead",
    company: "Thames Valley Clinic",
    country: "United Kingdom",
    city: "Oxford",
    about: "Point-of-care testing and lab logistics for a network of GP clinics.",
    avatar: "m6",
    subscription: { kind: "lapsed" },
    joinedDaysAgo: 200,
    lastLoginDaysAgo: 40,
  },
  {
    key: "nadia",
    email: "nadia.petrova@sofiagen.example",
    role: Role.USER,
    profileType: ProfileType.LABORATORY,
    firstName: "Nadia",
    lastName: "Petrova",
    title: "Genomics Technician",
    company: "SofiaGen Labs",
    country: "Bulgaria",
    city: "Sofia",
    about: "Sequencing operations and sample QC.",
    subscription: { kind: "trial", startedDaysAgo: 85 },
    joinedDaysAgo: 85,
    lastLoginDaysAgo: 2,
  },
  {
    key: "emre",
    email: "emre.yilmaz@mail.example",
    role: Role.USER,
    profileType: ProfileType.OTHER,
    firstName: "Emre",
    lastName: "Yılmaz",
    title: "Science Journalist",
    company: "Lab Times Europe",
    country: "Germany",
    city: "Munich",
    about: "Writing about lab automation, diagnostics and the people behind them.",
    avatar: "m7",
    subscription: { kind: "trial", startedDaysAgo: 30 },
    joinedDaysAgo: 30,
    lastLoginDaysAgo: 5,
  },
  {
    key: "hannah",
    email: "hannah.schmidt@berlinmed.example",
    role: Role.USER,
    profileType: ProfileType.HOSPITAL,
    firstName: "Hannah",
    lastName: "Schmidt",
    title: "Biomedical Scientist",
    company: "Berlin Medical Centre",
    country: "Germany",
    city: "Berlin",
    about: "Clinical chemistry and immunoassays.",
    avatar: "f8",
    status: UserStatus.SUSPENDED,
    warnings: 1,
    subscription: { kind: "monthly", startedDaysAgo: 18 },
    joinedDaysAgo: 150,
    lastLoginDaysAgo: 9,
  },
  {
    key: "viktor",
    email: "viktor.horvath@mail.example",
    role: Role.USER,
    profileType: ProfileType.PROFESSIONAL,
    firstName: "Viktor",
    lastName: "Horváth",
    title: "Lab Equipment Reseller",
    company: "Independent",
    country: "Hungary",
    city: "Budapest",
    about: "Buying and selling used lab equipment.",
    status: UserStatus.BANNED,
    warnings: 2,
    subscription: { kind: "lapsed" },
    joinedDaysAgo: 100,
    lastLoginDaysAgo: 21,
  },
  {
    key: "laura",
    email: "laura.martin@lyonbio.example",
    role: Role.USER,
    profileType: ProfileType.LABORATORY,
    firstName: "Laura",
    lastName: "Martin",
    title: "Research Assistant",
    company: "Lyon BioScience",
    country: "France",
    city: "Lyon",
    about: "Cell culture and ELISA. Microscopy enthusiast.",
    warnings: 1,
    subscription: { kind: "trial", startedDaysAgo: 45 },
    joinedDaysAgo: 45,
    lastLoginDaysAgo: 3,
  },

  // --- Suppliers -----------------------------------------------------------
  {
    key: "katrin",
    email: "katrin.vogel@vogelscientific.example",
    role: Role.SUPPLIER,
    profileType: ProfileType.SUPPLIER,
    firstName: "Katrin",
    lastName: "Vogel",
    title: "Key Account Manager",
    company: "Vogel Scientific GmbH",
    country: "Austria",
    city: "Vienna",
    about: "Spectroscopy and weighing solutions for pharma and food labs.",
    avatar: "f9",
    cover: "analyser",
    subscription: { kind: "yearly", startedDaysAgo: 40 },
    joinedDaysAgo: 210,
    lastLoginDaysAgo: 1,
  },
  {
    key: "daniel",
    email: "daniel.costa@lusolab.example",
    role: Role.SUPPLIER,
    profileType: ProfileType.SUPPLIER,
    firstName: "Daniel",
    lastName: "Costa",
    title: "Founder & CEO",
    company: "LusoLab Supplies",
    country: "Portugal",
    city: "Lisbon",
    about: "Consumables, glassware and PPE delivered across Iberia in 48 hours.",
    avatar: "m8",
    subscription: { kind: "monthly", startedDaysAgo: 8 },
    joinedDaysAgo: 175,
    lastLoginDaysAgo: 0,
  },
  {
    key: "sarah",
    email: "sarah.obrien@emeraldbio.example",
    role: Role.SUPPLIER,
    profileType: ProfileType.SUPPLIER,
    firstName: "Sarah",
    lastName: "O'Brien",
    title: "Technical Sales Specialist",
    company: "Emerald Biosystems",
    country: "Ireland",
    city: "Dublin",
    about: "Cell culture, incubation and cold-chain equipment.",
    avatar: "f10",
    subscription: { kind: "trial", startedDaysAgo: 14 },
    joinedDaysAgo: 14,
    lastLoginDaysAgo: 2,
  },
  {
    key: "henrik",
    email: "henrik.jensen@nordcal.example",
    role: Role.SUPPLIER,
    profileType: ProfileType.SUPPLIER,
    firstName: "Henrik",
    lastName: "Jensen",
    title: "Calibration Services Manager",
    company: "NordCal Calibration",
    country: "Denmark",
    city: "Copenhagen",
    about: "ISO 17025 accredited calibration for balances, pipettes and thermal equipment.",
    avatar: "m9",
    subscription: { kind: "yearly", startedDaysAgo: 250 },
    joinedDaysAgo: 255,
    lastLoginDaysAgo: 7,
  },
  {
    key: "julien",
    email: "julien.lefevre@optilab.example",
    role: Role.SUPPLIER,
    profileType: ProfileType.SUPPLIER,
    firstName: "Julien",
    lastName: "Lefèvre",
    title: "Product Specialist – Microscopy",
    company: "OptiLab France",
    country: "France",
    city: "Paris",
    about: "Upright, inverted and confocal microscopes; demos across France and Benelux.",
    avatar: "m10",
    subscription: { kind: "cancelled", startedDaysAgo: 10 },
    joinedDaysAgo: 130,
    lastLoginDaysAgo: 11,
  },
  {
    key: "eva",
    email: "eva.muller@safelab.example",
    role: Role.SUPPLIER,
    profileType: ProfileType.SUPPLIER,
    firstName: "Eva",
    lastName: "Müller",
    title: "Safety Equipment Consultant",
    company: "SafeLab Solutions",
    country: "Germany",
    city: "Hamburg",
    about: "Fume hoods, biosafety cabinets and PPE programmes.",
    subscription: { kind: "monthly", startedDaysAgo: 28 },
    joinedDaysAgo: 95,
    lastLoginDaysAgo: 4,
  },
  {
    key: "ravi",
    email: "ravi.mehta@quicklabdeals.example",
    role: Role.SUPPLIER,
    profileType: ProfileType.SUPPLIER,
    firstName: "Ravi",
    lastName: "Mehta",
    title: "Sales Representative",
    company: "QuickLab Deals",
    country: "United Kingdom",
    city: "London",
    about: "Discount lab supplies.",
    status: UserStatus.SUSPENDED,
    warnings: 1,
    subscription: { kind: "trial", startedDaysAgo: 35 },
    joinedDaysAgo: 35,
    lastLoginDaysAgo: 12,
  },
];

// ---------------------------------------------------------------------------
// Connections: [requester, addressee, status]
// ---------------------------------------------------------------------------

export const CONNECTIONS: [string, string, "ACCEPTED" | "PENDING" | "DECLINED"][] = [
  ["elise", "marcus", "ACCEPTED"],
  ["elise", "sofia", "ACCEPTED"],
  ["elise", "isabel", "ACCEPTED"],
  ["elise", "mariam", "ACCEPTED"],
  ["elise", "laura", "ACCEPTED"],
  ["anna", "elise", "ACCEPTED"],
  ["johan", "elise", "ACCEPTED"],
  ["katrin", "elise", "ACCEPTED"],
  ["chiara", "elise", "PENDING"],
  ["lukas", "elise", "PENDING"],
  ["elise", "thomas", "PENDING"],
  ["ravi", "elise", "DECLINED"],
  ["marcus", "sofia", "ACCEPTED"],
  ["marcus", "anna", "ACCEPTED"],
  ["marcus", "pieter", "ACCEPTED"],
  ["marcus", "henrik", "ACCEPTED"],
  ["marcus", "katrin", "ACCEPTED"],
  ["isabel", "marcus", "ACCEPTED"],
  ["nadia", "marcus", "PENDING"],
  ["emre", "marcus", "PENDING"],
  ["sofia", "pieter", "ACCEPTED"],
  ["sofia", "chiara", "ACCEPTED"],
  ["sofia", "johan", "ACCEPTED"],
  ["anna", "johan", "ACCEPTED"],
  ["anna", "hannah", "ACCEPTED"],
  ["anna", "lukas", "ACCEPTED"],
  ["pieter", "nadia", "ACCEPTED"],
  ["isabel", "daniel", "ACCEPTED"],
  ["isabel", "mariam", "ACCEPTED"],
  ["mariam", "henrik", "ACCEPTED"],
  ["mariam", "thomas", "ACCEPTED"],
  ["laura", "julien", "ACCEPTED"],
  ["laura", "sofia", "PENDING"],
  ["oliver", "anna", "ACCEPTED"],
  ["daniel", "sarah", "ACCEPTED"],
  ["katrin", "henrik", "ACCEPTED"],
  ["eva", "isabel", "PENDING"],
  ["viktor", "pieter", "DECLINED"],
  ["viktor", "oliver", "DECLINED"],
  ["emre", "johan", "ACCEPTED"],
  ["sarah", "sofia", "PENDING"],
  ["julien", "johan", "ACCEPTED"],
];

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export interface SeedComment {
  author: string;
  content: string;
  likes?: string[];
  replies?: { author: string; content: string; likes?: string[] }[];
}

export interface SeedFeedPost {
  author: string;
  type: FeedPostType;
  content: string;
  image?: LabImage;
  document?: string;
  daysAgo: number;
  reactions?: Partial<Record<"like" | "love" | "haha" | "wow" | "sad" | "angry", string[]>>;
  comments?: SeedComment[];
}

export const FEED_POSTS: SeedFeedPost[] = [
  {
    author: "elise",
    type: FeedPostType.QUESTION,
    content:
      "Which HPLC column do you recommend for peptide separation under acidic conditions? We're seeing peak tailing on our current C18 at pH 2.",
    image: "glassware",
    daysAgo: 1,
    reactions: { like: ["sofia", "marcus", "pieter"], wow: ["thomas"] },
    comments: [
      {
        author: "sofia",
        content: "Try a C18 with charged-surface hybrid particles — tailing dropped a lot for us.",
        likes: ["elise", "pieter"],
        replies: [
          { author: "elise", content: "Thanks! Which particle size are you running?", likes: ["sofia"] },
          { author: "sofia", content: "1.7 µm on UHPLC, 2.7 µm core-shell on the older system." },
        ],
      },
      {
        author: "marcus",
        content: "We have a few demo columns in stock — happy to send one for a trial run.",
        likes: ["elise"],
      },
    ],
  },
  {
    author: "marcus",
    type: FeedPostType.INFORMATION,
    content:
      "We just released a new line of energy-efficient CO₂ incubators — 30% lower power draw and HEPA-filtered airflow. AMA below!",
    image: "sampleTray",
    daysAgo: 2,
    reactions: { like: ["elise", "anna", "katrin"], love: ["sarah"] },
    comments: [
      {
        author: "anna",
        content: "What's the recovery time after a door opening?",
        replies: [{ author: "marcus", content: "Under 5 minutes to 5% CO₂ and 37 °C." }],
      },
    ],
  },
  {
    author: "anna",
    type: FeedPostType.INFORMATION,
    content:
      "Our team published updated AMR surveillance data for Q2: carbapenem resistance in K. pneumoniae is down 4% since we introduced rapid PCR screening at admission.",
    document: "amr-surveillance-q2.pdf",
    daysAgo: 3,
    reactions: { like: ["johan", "elise", "oliver", "lukas"], love: ["hannah"], wow: ["emre"] },
    comments: [
      { author: "johan", content: "Great results. Did turnaround time change much?", likes: ["anna"] },
      { author: "oliver", content: "Sharing this with our clinic network — thanks Anna." },
    ],
  },
  {
    author: "pieter",
    type: FeedPostType.QUESTION,
    content:
      "Anyone validated a bead-based cleanup to replace column kits for NGS library prep? Looking for real-world yield comparisons.",
    daysAgo: 4,
    reactions: { like: ["nadia", "sofia"] },
    comments: [
      {
        author: "nadia",
        content: "Yes — 0.8× ratio gave us comparable yield and much better size selection.",
        likes: ["pieter"],
      },
    ],
  },
  {
    author: "katrin",
    type: FeedPostType.SUPPLIERS,
    content:
      "Vogel Scientific now offers free on-site balance qualification (IQ/OQ) with every analytical balance ordered before December.",
    image: "instrumentBench",
    daysAgo: 5,
    reactions: { like: ["mariam", "henrik"] },
  },
  {
    author: "isabel",
    type: FeedPostType.QUESTION,
    content:
      "Looking for a reliable supplier of nitrile gloves in Spain — our current one keeps missing deliveries. Recommendations?",
    daysAgo: 6,
    reactions: { like: ["daniel"], sad: ["mariam"] },
    comments: [
      {
        author: "daniel",
        content: "LusoLab delivers across Iberia in 48h — I'll DM you our price list.",
        replies: [{ author: "isabel", content: "Perfect, thank you Daniel!" }],
      },
      { author: "eva", content: "SafeLab also ships to Spain, happy to quote." },
    ],
  },
  {
    author: "johan",
    type: FeedPostType.INFORMATION,
    content:
      "Two years into full digital pathology: scanning every slide cut our case sign-out time by 18%. Happy to share our validation protocol.",
    image: "microscopeScientist",
    daysAgo: 8,
    reactions: { like: ["sofia", "anna", "emre"], love: ["julien"], wow: ["elise"] },
    comments: [
      { author: "emre", content: "Would love to feature this in Lab Times — can I reach out?", likes: ["johan"] },
    ],
  },
  {
    author: "mariam",
    type: FeedPostType.INFORMATION,
    content:
      "Reminder: ISO/IEC 17025:2017 transition audits focus heavily on risk-based thinking. I've put together a short checklist for small labs.",
    document: "iso17025-checklist.pdf",
    daysAgo: 9,
    reactions: { like: ["isabel", "henrik", "elise", "thomas"] },
  },
  {
    author: "henrik",
    type: FeedPostType.SUPPLIERS,
    content:
      "Pipette calibration tip: gravimetric checks every 3 months catch drift long before the annual service. NordCal can set up a schedule for you.",
    image: "pipetteVial",
    daysAgo: 11,
    reactions: { like: ["mariam", "laura"] },
  },
  {
    author: "chiara",
    type: FeedPostType.QUESTION,
    content:
      "PhD student here — what skills made the biggest difference when you moved from academia to an industry lab?",
    daysAgo: 1,
    reactions: { like: ["sofia", "elise"], love: ["laura"] },
    comments: [
      { author: "sofia", content: "GMP/GLP awareness and documentation habits, without a doubt.", likes: ["chiara"] },
      { author: "elise", content: "Learn one LIMS well. It shows you understand regulated workflows." },
    ],
  },
  {
    author: "laura",
    type: FeedPostType.INFORMATION,
    content: "First confocal images from our new setup — HeLa cells stained for actin and nuclei. 🔬",
    image: "cells",
    daysAgo: 13,
    reactions: { love: ["julien", "sofia"], wow: ["chiara"] },
  },
  {
    author: "daniel",
    type: FeedPostType.SUPPLIERS,
    content: "Back in stock: borosilicate beakers and volumetric flasks (Class A). Bulk discounts for 50+ units.",
    image: "beakers",
    daysAgo: 15,
    reactions: { like: ["isabel"] },
  },
  {
    author: "emre",
    type: FeedPostType.QUESTION,
    content:
      "Writing a piece on lab automation adoption in mid-size labs. What's been the biggest blocker for you — budget, space or staff training?",
    daysAgo: 18,
    reactions: { like: ["johan", "anna"] },
    comments: [
      { author: "anna", content: "Staff training, honestly. The robots were the easy part." },
      { author: "isabel", content: "Budget. Validation costs are often higher than the instrument." },
    ],
  },
  {
    author: "viktor",
    type: FeedPostType.SUPPLIERS,
    content: "Cheap centrifuges!!! Brand new, 90% off, pay by bank transfer only. Message me now.",
    daysAgo: 22,
    reactions: { angry: ["marcus", "katrin"] },
  },
  {
    author: "thomas",
    type: FeedPostType.QUESTION,
    content: "Has anyone moved dissolution testing to automated sampling? Worth it for ~200 tests/month?",
    daysAgo: 30,
    reactions: { like: ["elise"] },
  },
  {
    author: "sofia",
    type: FeedPostType.INFORMATION,
    content:
      "We're hosting an open lab day in Milan on 14 November — tours of our organoid facility and short talks. Everyone welcome!",
    image: "labTeam",
    daysAgo: 40,
    reactions: { like: ["chiara", "pieter", "elise"], love: ["laura"] },
  },
];

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

export interface SeedListing {
  seller: string;
  title: string;
  description: string;
  condition: ListingCondition;
  category: ListingCategory;
  year?: number;
  priceEur: number;
  location: string;
  images: LabImage[];
  status?: "ACTIVE" | "SOLD" | "REMOVED";
  daysAgo: number;
  savedBy?: string[];
}

export const LISTINGS: SeedListing[] = [
  {
    seller: "elise",
    title: "Agilent 1260 Infinity II HPLC System",
    description: "Well-maintained HPLC system, recently serviced, includes DAD detector and autosampler.",
    condition: ListingCondition.LIKE_NEW,
    category: ListingCategory.CHROMATOGRAPHY,
    year: 2021,
    priceEur: 14500,
    location: "Lyon, France",
    images: ["glassware", "instrumentBench"],
    daysAgo: 6,
    savedBy: ["thomas", "isabel"],
  },
  {
    seller: "marcus",
    title: "Refurbished GC-MS with Autosampler",
    description: "Fully refurbished GC-MS, new source and pump, 12-month warranty and installation included.",
    condition: ListingCondition.REFURBISHED,
    category: ListingCategory.CHROMATOGRAPHY,
    year: 2018,
    priceEur: 38900,
    location: "Berlin, Germany",
    images: ["analyser"],
    daysAgo: 10,
    savedBy: ["elise"],
  },
  {
    seller: "katrin",
    title: "UV-Vis Spectrophotometer, double beam",
    description: "190–1100 nm, 1 nm bandwidth. Demo unit used for trade shows only.",
    condition: ListingCondition.LIKE_NEW,
    category: ListingCategory.SPECTROSCOPY,
    year: 2024,
    priceEur: 7200,
    location: "Vienna, Austria",
    images: ["instrumentBench"],
    daysAgo: 4,
    savedBy: ["sofia", "laura"],
  },
  {
    seller: "sofia",
    title: "FTIR Spectrometer with ATR accessory",
    description: "Replacing with a newer model. Diamond ATR, software licence transferable.",
    condition: ListingCondition.GOOD,
    category: ListingCategory.SPECTROSCOPY,
    year: 2017,
    priceEur: 9800,
    location: "Milan, Italy",
    images: ["flask"],
    status: "SOLD",
    daysAgo: 45,
  },
  {
    seller: "sarah",
    title: "CO₂ Incubator 170 L, HEPA filtered",
    description: "Brand new, sealed box. Copper interior, IR CO₂ sensor, 5-year warranty.",
    condition: ListingCondition.NEW,
    category: ListingCategory.INCUBATION,
    year: 2026,
    priceEur: 6450,
    location: "Dublin, Ireland",
    images: ["sampleTray"],
    daysAgo: 2,
    savedBy: ["sofia"],
  },
  {
    seller: "pieter",
    title: "Shaking incubator, benchtop",
    description: "Orbital shaker incubator, 25 mm throw, up to 60 °C. Minor cosmetic wear.",
    condition: ListingCondition.GOOD,
    category: ListingCategory.INCUBATION,
    year: 2019,
    priceEur: 2100,
    location: "Amsterdam, Netherlands",
    images: ["testTubes"],
    daysAgo: 20,
  },
  {
    seller: "marcus",
    title: "Refrigerated Benchtop Centrifuge",
    description: "4 × 750 mL swing-out rotor, −10 to 40 °C. Serviced and certified.",
    condition: ListingCondition.REFURBISHED,
    category: ListingCategory.CENTRIFUGATION,
    year: 2020,
    priceEur: 5600,
    location: "Berlin, Germany",
    images: ["labBenches"],
    daysAgo: 12,
    savedBy: ["anna", "lukas"],
  },
  {
    seller: "lukas",
    title: "Microcentrifuge 24-place",
    description: "Works perfectly; lid latch replaced last year.",
    condition: ListingCondition.GOOD,
    category: ListingCategory.CENTRIFUGATION,
    year: 2016,
    priceEur: 480,
    location: "Prague, Czech Republic",
    images: ["pipettePlate"],
    daysAgo: 8,
  },
  {
    seller: "katrin",
    title: "Analytical Balance 0.1 mg, 220 g",
    description: "Internal calibration, draft shield, USB/LAN. Includes IQ/OQ documentation.",
    condition: ListingCondition.NEW,
    category: ListingCategory.WEIGHING,
    year: 2026,
    priceEur: 2350,
    location: "Vienna, Austria",
    images: ["beakers"],
    daysAgo: 3,
    savedBy: ["mariam"],
  },
  {
    seller: "henrik",
    title: "Precision balance for parts — display fault",
    description: "Load cell OK, display intermittently fails. Sold as-is for spares or repair.",
    condition: ListingCondition.FOR_PARTS,
    category: ListingCategory.WEIGHING,
    year: 2012,
    priceEur: 90,
    location: "Copenhagen, Denmark",
    images: ["engineer"],
    daysAgo: 25,
  },
  {
    seller: "eva",
    title: "Class II Biosafety Cabinet, 1.2 m",
    description: "EN 12469 certified, UV lamp, recently re-certified with new HEPA filters.",
    condition: ListingCondition.REFURBISHED,
    category: ListingCategory.SAFETY,
    year: 2019,
    priceEur: 7900,
    location: "Hamburg, Germany",
    images: ["goggles"],
    daysAgo: 9,
    savedBy: ["anna"],
  },
  {
    seller: "daniel",
    title: "Nitrile gloves, powder-free — 10 boxes",
    description: "Sizes S–XL, 100 per box, EN 374 certified. Price per 10-box bundle.",
    condition: ListingCondition.NEW,
    category: ListingCategory.CONSUMABLES,
    priceEur: 65,
    location: "Lisbon, Portugal",
    images: ["goggles"],
    daysAgo: 1,
    savedBy: ["isabel"],
  },
  {
    seller: "daniel",
    title: "Filter pipette tips, 1000 µL — case of 960",
    description: "Sterile, low-retention, DNase/RNase free. Racked.",
    condition: ListingCondition.NEW,
    category: ListingCategory.CONSUMABLES,
    priceEur: 120,
    location: "Lisbon, Portugal",
    images: ["pipetteVial"],
    daysAgo: 14,
  },
  {
    seller: "julien",
    title: "Inverted Fluorescence Microscope",
    description: "LED fluorescence (DAPI/FITC/TRITC), 4×–40× objectives, camera included.",
    condition: ListingCondition.LIKE_NEW,
    category: ListingCategory.MICROSCOPY,
    year: 2023,
    priceEur: 18500,
    location: "Paris, France",
    images: ["microscope", "cells"],
    daysAgo: 7,
    savedBy: ["laura", "sofia", "johan"],
  },
  {
    seller: "laura",
    title: "Student microscope set (x3)",
    description: "Three compound microscopes, ideal for teaching labs.",
    condition: ListingCondition.GOOD,
    category: ListingCategory.MICROSCOPY,
    year: 2015,
    priceEur: 600,
    location: "Lyon, France",
    images: ["microscopeRow"],
    status: "SOLD",
    daysAgo: 60,
  },
  {
    seller: "viktor",
    title: "Brand new ultracentrifuge — 90% off!!!",
    description: "Pay by bank transfer only. No viewing. Ships from abroad.",
    condition: ListingCondition.NEW,
    category: ListingCategory.CENTRIFUGATION,
    priceEur: 1500,
    location: "Budapest, Hungary",
    images: [],
    status: "REMOVED",
    daysAgo: 23,
  },
];

// ---------------------------------------------------------------------------
// Recruitment
// ---------------------------------------------------------------------------

export interface SeedJob {
  owner: string;
  title: string;
  company: string;
  location: string;
  employmentType: EmploymentType;
  level: JobLevel;
  salary?: string;
  image?: LabImage;
  about: string;
  requirements: string[];
  status?: "OPEN" | "CLOSED" | "REMOVED";
  daysAgo: number;
  applications?: { applicant: string; status: "APPLIED" | "REVIEWED" | "ACCEPTED" | "REJECTED"; coverLetter?: string }[];
}

export const JOBS: SeedJob[] = [
  {
    owner: "marcus",
    title: "Quality Control Analyst",
    company: "BauerLab Instruments",
    location: "Berlin, Germany",
    employmentType: EmploymentType.FULL_TIME,
    level: JobLevel.MID_LEVEL,
    salary: "€45,000 – €55,000",
    image: "instrumentBench",
    about: "Perform QC testing on incoming laboratory instruments and consumables.",
    requirements: ["BSc in Chemistry or related field", "2+ years QC experience", "GMP knowledge"],
    daysAgo: 5,
    applications: [
      { applicant: "chiara", status: "REVIEWED", coverLetter: "I have 4 years of hands-on analytical work during my PhD and I'm keen to move into QC." },
      { applicant: "laura", status: "APPLIED" },
      { applicant: "thomas", status: "REJECTED", coverLetter: "Experienced analytical chemist relocating to Berlin." },
    ],
  },
  {
    owner: "elise",
    title: "HPLC Laboratory Technician",
    company: "Novagen Labs",
    location: "Lyon, France",
    employmentType: EmploymentType.FULL_TIME,
    level: JobLevel.ENTRY_LEVEL,
    salary: "€32,000 – €36,000",
    image: "glassware",
    about: "Join our QC team running routine HPLC release testing under GMP.",
    requirements: ["BTS/DUT or BSc in analytical chemistry", "French and English", "Attention to detail"],
    daysAgo: 3,
    applications: [
      { applicant: "laura", status: "ACCEPTED", coverLetter: "I already work in Lyon and use HPLC daily for ELISA sample prep." },
      { applicant: "chiara", status: "APPLIED" },
    ],
  },
  {
    owner: "anna",
    title: "Clinical Microbiologist",
    company: "Warsaw University Hospital",
    location: "Warsaw, Poland",
    employmentType: EmploymentType.FULL_TIME,
    level: JobLevel.SENIOR,
    salary: "Competitive, based on experience",
    image: "testTubes",
    about: "Lead the bacteriology bench and support our AMR surveillance programme.",
    requirements: ["Specialisation in medical microbiology", "5+ years clinical experience", "MALDI-TOF experience"],
    daysAgo: 10,
    applications: [{ applicant: "lukas", status: "REVIEWED" }],
  },
  {
    owner: "sofia",
    title: "Research Intern – 3D Cell Culture",
    company: "BioMedica Research",
    location: "Milan, Italy",
    employmentType: EmploymentType.INTERNSHIP,
    level: JobLevel.ENTRY_LEVEL,
    salary: "€1,200 / month stipend",
    image: "cells",
    about: "Six-month internship developing organoid models for toxicity screening.",
    requirements: ["Enrolled in MSc/PhD in life sciences", "Sterile technique", "Italian or English"],
    daysAgo: 7,
    applications: [{ applicant: "chiara", status: "APPLIED", coverLetter: "My thesis uses spheroid cultures — this internship is a perfect fit." }],
  },
  {
    owner: "katrin",
    title: "Field Service Engineer – Spectroscopy",
    company: "Vogel Scientific GmbH",
    location: "Vienna, Austria (travel DACH)",
    employmentType: EmploymentType.FULL_TIME,
    level: JobLevel.MID_LEVEL,
    salary: "€50,000 + car",
    image: "engineer",
    about: "Install, qualify and repair UV-Vis, FTIR and AAS instruments at customer sites.",
    requirements: ["Electronics or instrumentation background", "Driving licence", "German and English"],
    daysAgo: 14,
  },
  {
    owner: "henrik",
    title: "Calibration Technician (part-time)",
    company: "NordCal Calibration",
    location: "Copenhagen, Denmark",
    employmentType: EmploymentType.PART_TIME,
    level: JobLevel.ENTRY_LEVEL,
    salary: "DKK 190 / hour",
    about: "Gravimetric pipette and balance calibration in our accredited lab.",
    requirements: ["Technical education", "Careful, methodical work style"],
    daysAgo: 21,
    applications: [{ applicant: "nadia", status: "APPLIED" }],
  },
  {
    owner: "mariam",
    title: "ISO 17025 Documentation Specialist (contract)",
    company: "Independent",
    location: "Remote (EU)",
    employmentType: EmploymentType.CONTRACT,
    level: JobLevel.SENIOR,
    salary: "€450 / day",
    about: "Three-month contract to rebuild a quality manual and SOP set ahead of accreditation.",
    requirements: ["Proven ISO 17025 experience", "Excellent written English"],
    daysAgo: 16,
    applications: [{ applicant: "isabel", status: "REVIEWED" }],
  },
  {
    owner: "johan",
    title: "Histotechnologist",
    company: "Nordic Pathology Centre",
    location: "Stockholm, Sweden",
    employmentType: EmploymentType.FULL_TIME,
    level: JobLevel.MID_LEVEL,
    image: "microscopeScientist",
    about: "Tissue processing, sectioning and IHC staining in a fully digital department.",
    requirements: ["Biomedical scientist licence", "IHC experience"],
    status: "CLOSED",
    daysAgo: 70,
    applications: [{ applicant: "hannah", status: "ACCEPTED" }],
  },
  {
    owner: "ravi",
    title: "Earn €5,000/week from home!!!",
    company: "QuickLab Deals",
    location: "Remote",
    employmentType: EmploymentType.CONTRACT,
    level: JobLevel.ENTRY_LEVEL,
    about: "No experience needed. Send a registration fee to get started.",
    requirements: [],
    status: "REMOVED",
    daysAgo: 30,
  },
];

// ---------------------------------------------------------------------------
// General posts (news & documents)
// ---------------------------------------------------------------------------

export interface SeedGeneralPost {
  author: string;
  type: GeneralPostType;
  title: string;
  summary: string;
  category: string;
  source: string;
  image?: LabImage;
  document?: string;
  body: string[];
  daysAgo: number;
}

export const GENERAL_POSTS: SeedGeneralPost[] = [
  {
    author: "admin",
    type: GeneralPostType.NEWS,
    title: "EU publishes updated PPE requirements for laboratories",
    summary:
      "The European Commission has published updated safety requirements for personal protective equipment in laboratory environments, effective January 2027.",
    category: "Regulations",
    source: "European Commission",
    image: "goggles",
    body: [
      "The new regulation covers PPE standards including gloves, goggles and lab coats.",
      "All certified PPE must carry the updated CE mark from January 2027.",
    ],
    daysAgo: 2,
  },
  {
    author: "admin",
    type: GeneralPostType.NEWS,
    title: "Lab Automation Summit 2026 — registration open",
    summary: "Two days of talks and live demos on robotics, LIMS integration and AI-assisted QC in Rotterdam.",
    category: "Events",
    source: "Lab Unity",
    image: "labTeam",
    body: [
      "The summit takes place in Rotterdam on 3–4 December.",
      "Lab Unity members get a 20% discount with the code LABUNITY20.",
    ],
    daysAgo: 6,
  },
  {
    author: "moderator",
    type: GeneralPostType.NEWS,
    title: "Horizon Europe opens new call for diagnostics research",
    summary: "€95 million available for projects on rapid diagnostics and antimicrobial resistance.",
    category: "Funding",
    source: "European Research Executive Agency",
    image: "funding",
    body: [
      "Consortia of at least three member states are eligible.",
      "The deadline for first-stage proposals is 15 February 2027.",
    ],
    daysAgo: 12,
  },
  {
    author: "admin",
    type: GeneralPostType.NEWS,
    title: "Free webinar series: GMP data integrity in practice",
    summary: "Four one-hour sessions covering ALCOA+, audit trails and electronic records.",
    category: "Training",
    source: "Lab Unity Academy",
    image: "instrumentBench",
    body: ["Sessions run every Thursday in November at 14:00 CET.", "Recordings are available to all members."],
    daysAgo: 20,
  },
  {
    author: "admin",
    type: GeneralPostType.DOCUMENT,
    title: "Laboratory Safety Checklist (2026 edition)",
    summary: "A printable checklist covering chemical storage, fume hoods, waste and emergency equipment.",
    category: "Safety",
    source: "Lab Unity",
    document: "lab-safety-checklist.pdf",
    body: ["Review this checklist monthly and keep signed copies for audits."],
    daysAgo: 9,
  },
  {
    author: "moderator",
    type: GeneralPostType.DOCUMENT,
    title: "Template: Equipment Qualification (IQ/OQ/PQ) Protocol",
    summary: "An editable protocol template for qualifying new laboratory instruments.",
    category: "Quality",
    source: "Lab Unity",
    document: "equipment-qualification-template.pdf",
    body: ["Adapt the acceptance criteria to your instrument and intended use."],
    daysAgo: 25,
  },
];

// ---------------------------------------------------------------------------
// Blogs
// ---------------------------------------------------------------------------

export interface SeedBlog {
  author: string;
  slug: string;
  category: string;
  title: string;
  excerpt: string;
  image: LabImage;
  readTime: string;
  body: string;
  /** null = draft */
  publishedDaysAgo: number | null;
}

export const BLOGS: SeedBlog[] = [
  {
    author: "admin",
    slug: "welcome-to-lab-unity",
    category: "Industry News",
    title: "Welcome to Lab Unity",
    excerpt: "The professional network built for laboratories, suppliers and lab professionals.",
    image: "labTeam",
    readTime: "4 min read",
    body:
      "Lab Unity connects laboratories, suppliers and professionals across Europe.\n\nShare knowledge in the feed, buy and sell equipment in the marketplace, find your next role in recruitment and stay current with news and documents.",
    publishedDaysAgo: 200,
  },
  {
    author: "admin",
    slug: "future-of-lab-automation",
    category: "Technology",
    title: "The Future of Lab Automation",
    excerpt: "From liquid handlers to autonomous labs: what mid-size laboratories should plan for next.",
    image: "analyser",
    readTime: "6 min read",
    body:
      "Automation is no longer reserved for high-throughput screening centres.\n\nModular liquid handlers, cloud LIMS and scheduling software make it realistic for labs running a few hundred samples a day.",
    publishedDaysAgo: 30,
  },
  {
    author: "moderator",
    slug: "buying-refurbished-lab-equipment-safely",
    category: "Marketplace",
    title: "Buying Refurbished Lab Equipment Safely",
    excerpt: "Seven checks to make before you pay for a used instrument.",
    image: "instrumentBench",
    readTime: "5 min read",
    body:
      "Ask for service history, verify the serial number with the manufacturer and never pay by untraceable bank transfer to a seller you haven't verified.",
    publishedDaysAgo: 14,
  },
  {
    author: "admin",
    slug: "iso-15189-accreditation-guide",
    category: "Quality",
    title: "A Practical Guide to ISO 15189 Accreditation",
    excerpt: "What assessors look for and how to prepare your medical laboratory.",
    image: "testTubes",
    readTime: "8 min read",
    body: "Start with a gap analysis, assign clear document owners and run at least one full internal audit cycle.",
    publishedDaysAgo: 5,
  },
  {
    author: "admin",
    slug: "sustainable-laboratories",
    category: "Sustainability",
    title: "Greener Labs: Cutting Energy Use Without Cutting Corners",
    excerpt: "Freezer management, fume hood habits and smarter procurement.",
    image: "beakers",
    readTime: "5 min read",
    body: "Raising ULT freezers from −80 °C to −70 °C can reduce their energy use by up to 30%.",
    publishedDaysAgo: null,
  },
];

// ---------------------------------------------------------------------------
// Advertisements
// ---------------------------------------------------------------------------

export interface SeedAd {
  supplier: string;
  title: string;
  category: AdCategory;
  description: string;
  image?: LabImage;
  priceEur?: number;
  contact?: string;
  location?: string;
  durationDays: 7 | 14 | 30;
  state: "pending" | "active" | "expired" | "rejected";
  /** For active/expired: days since the ad went live. */
  startedDaysAgo?: number;
  createdDaysAgo: number;
  rejectionReason?: string;
  event?: { inDays: number; time: string; organizer: string };
  views?: number;
  clicks?: number;
}

export const ADS: SeedAd[] = [
  {
    supplier: "marcus",
    title: "New CO₂ Incubator Line — Launch Offer",
    category: AdCategory.PRODUCT,
    description: "Energy-efficient incubators with a 20% launch discount for the first 50 orders.",
    image: "sampleTray",
    priceEur: 8450,
    contact: "sales@bauerlab.example",
    location: "Berlin, Germany",
    durationDays: 14,
    state: "active",
    startedDaysAgo: 3,
    createdDaysAgo: 4,
    views: 1240,
    clicks: 86,
  },
  {
    supplier: "katrin",
    title: "Free IQ/OQ with every analytical balance",
    category: AdCategory.PROMO,
    description: "Order any analytical balance before 31 December and get on-site qualification free.",
    image: "instrumentBench",
    contact: "katrin.vogel@vogelscientific.example",
    location: "Vienna, Austria",
    durationDays: 30,
    state: "active",
    startedDaysAgo: 10,
    createdDaysAgo: 11,
    views: 2310,
    clicks: 174,
  },
  {
    supplier: "henrik",
    title: "Accredited pipette calibration — from €9 per channel",
    category: AdCategory.SERVICE,
    description: "ISO 17025 accredited, 5-day turnaround, free pickup in Copenhagen and Malmö.",
    image: "pipetteVial",
    priceEur: 9,
    contact: "+45 33 00 12 34",
    location: "Copenhagen, Denmark",
    durationDays: 30,
    state: "active",
    startedDaysAgo: 20,
    createdDaysAgo: 21,
    views: 980,
    clicks: 41,
  },
  {
    supplier: "julien",
    title: "Webinar: Getting Started with Live-Cell Imaging",
    category: AdCategory.WEBINAR,
    description: "A 45-minute session on environmental control, phototoxicity and time-lapse set-up.",
    image: "microscope",
    location: "Online",
    durationDays: 14,
    state: "active",
    startedDaysAgo: 2,
    createdDaysAgo: 3,
    event: { inDays: 9, time: "15:00 CET", organizer: "OptiLab France" },
    views: 430,
    clicks: 52,
  },
  {
    supplier: "sarah",
    title: "Cold-chain sample storage audit",
    category: AdCategory.SERVICE,
    description: "We'll map your freezers and fridges and deliver a temperature-risk report within a week.",
    image: "testTubes",
    contact: "sarah.obrien@emeraldbio.example",
    location: "Dublin, Ireland",
    durationDays: 7,
    state: "pending",
    createdDaysAgo: 1,
  },
  {
    supplier: "daniel",
    title: "Bulk consumables bundle — 15% off",
    category: AdCategory.PROMO,
    description: "Gloves, tips and tubes in one monthly delivery. Cancel any time.",
    image: "pipettePlate",
    priceEur: 199,
    contact: "orders@lusolab.example",
    location: "Lisbon, Portugal",
    durationDays: 14,
    state: "pending",
    createdDaysAgo: 2,
  },
  {
    supplier: "eva",
    title: "Fume hood face-velocity testing",
    category: AdCategory.SERVICE,
    description: "EN 14175 testing and certification for fume hoods across northern Germany.",
    image: "goggles",
    location: "Hamburg, Germany",
    durationDays: 7,
    state: "expired",
    startedDaysAgo: 40,
    createdDaysAgo: 41,
    views: 610,
    clicks: 23,
  },
  {
    supplier: "marcus",
    title: "Summer clearance: refurbished centrifuges",
    category: AdCategory.PRODUCT,
    description: "Selected refurbished centrifuges with 12-month warranty at clearance prices.",
    image: "labBenches",
    priceEur: 3900,
    location: "Berlin, Germany",
    durationDays: 30,
    state: "expired",
    startedDaysAgo: 75,
    createdDaysAgo: 76,
    views: 3120,
    clicks: 205,
  },
  {
    supplier: "ravi",
    title: "90% OFF ALL LAB EQUIPMENT — TODAY ONLY",
    category: AdCategory.PROMO,
    description: "Limited stock!!! Pay upfront by bank transfer to secure your order.",
    durationDays: 7,
    state: "rejected",
    createdDaysAgo: 30,
    rejectionReason:
      "Misleading pricing and upfront bank-transfer payment requests violate our advertising guidelines.",
  },
];

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface SeedMessage {
  from: string;
  body: string;
  minutesAgo: number;
  attachment?: { kind: "image"; image: LabImage; name: string } | { kind: "pdf"; file: string; name: string };
}

export interface SeedConversation {
  group?: { name: string; owner: string };
  members: string[];
  /** Participants who have NOT read the latest messages. */
  unreadBy?: string[];
  messages: SeedMessage[];
}

export const CONVERSATIONS: SeedConversation[] = [
  {
    members: ["elise", "marcus"],
    unreadBy: ["elise"],
    messages: [
      { from: "elise", body: "Hi Marcus, is the refurbished GC-MS still available?", minutesAgo: 2880 },
      { from: "marcus", body: "Hi Élise! Yes it is. I can arrange a demo next week if you like.", minutesAgo: 2860 },
      { from: "elise", body: "That would be great. Could you send the service report?", minutesAgo: 2850 },
      {
        from: "marcus",
        body: "Here's the full service report.",
        minutesAgo: 90,
        attachment: { kind: "pdf", file: "gcms-service-report.pdf", name: "GC-MS service report.pdf" },
      },
      { from: "marcus", body: "Tuesday or Wednesday works for the demo on our side.", minutesAgo: 88 },
    ],
  },
  {
    members: ["elise", "sofia"],
    messages: [
      { from: "sofia", body: "Loved your question about peptide columns — did the CSH column help?", minutesAgo: 1500 },
      { from: "elise", body: "Tailing is almost gone. Thanks again!", minutesAgo: 1440 },
      {
        from: "sofia",
        body: "Nice! Here's the chromatogram from our side for comparison.",
        minutesAgo: 1400,
        attachment: { kind: "image", image: "glassware", name: "chromatogram-comparison.jpg" },
      },
      { from: "elise", body: "Very close to ours. Coffee at the Milan open day?", minutesAgo: 1380 },
      { from: "sofia", body: "Absolutely ☕", minutesAgo: 1370 },
    ],
  },
  {
    members: ["anna", "johan"],
    unreadBy: ["johan"],
    messages: [
      { from: "anna", body: "Johan, could I borrow your digital pathology validation protocol?", minutesAgo: 600 },
      { from: "johan", body: "Of course, I'll clean it up and share it tomorrow.", minutesAgo: 560 },
      { from: "anna", body: "Thank you! Also — are you presenting in Rotterdam?", minutesAgo: 30 },
    ],
  },
  {
    members: ["isabel", "daniel"],
    unreadBy: ["isabel"],
    messages: [
      { from: "isabel", body: "Hi Daniel, following up on the nitrile gloves.", minutesAgo: 4300 },
      {
        from: "daniel",
        body: "Hi Isabel, price list attached. 48h delivery to Madrid.",
        minutesAgo: 4200,
        attachment: { kind: "pdf", file: "lusolab-price-list.pdf", name: "LusoLab price list 2026.pdf" },
      },
      { from: "daniel", body: "Let me know if you'd like samples first.", minutesAgo: 240 },
    ],
  },
  {
    members: ["admin", "hannah"],
    messages: [
      {
        from: "admin",
        body: "Hi Hannah, your account has been temporarily suspended after repeated reports. You can reply here to appeal.",
        minutesAgo: 10000,
      },
      { from: "hannah", body: "I understand. I'd like to appeal — can we discuss?", minutesAgo: 9800 },
    ],
  },
  {
    members: ["chiara", "sofia"],
    unreadBy: ["sofia"],
    messages: [{ from: "chiara", body: "Hi Sofia, I just applied for the 3D cell culture internship!", minutesAgo: 120 }],
  },
  {
    group: { name: "Microbiology Network EU", owner: "anna" },
    members: ["anna", "johan", "lukas", "oliver", "hannah", "elise"],
    unreadBy: ["elise", "oliver"],
    messages: [
      { from: "anna", body: "Welcome everyone! A space to share AMR data and diagnostics tips.", minutesAgo: 20000 },
      { from: "lukas", body: "Thanks Anna. Is anyone using MALDI-TOF for direct blood culture ID?", minutesAgo: 15000 },
      { from: "johan", body: "We are — happy to share our workflow.", minutesAgo: 14800 },
      {
        from: "anna",
        body: "Q2 surveillance summary for the group.",
        minutesAgo: 300,
        attachment: { kind: "pdf", file: "amr-surveillance-q2.pdf", name: "AMR surveillance Q2.pdf" },
      },
      { from: "lukas", body: "Very useful, thank you!", minutesAgo: 45 },
    ],
  },
  {
    group: { name: "Lab Equipment Buyers", owner: "marcus" },
    members: ["marcus", "katrin", "henrik", "elise", "isabel"],
    unreadBy: ["isabel"],
    messages: [
      { from: "marcus", body: "Group for coordinating joint equipment purchases and service contracts.", minutesAgo: 30000 },
      { from: "katrin", body: "Happy to offer group pricing on balances.", minutesAgo: 25000 },
      { from: "henrik", body: "Same for calibration contracts — 10% for 3+ labs.", minutesAgo: 24000 },
      { from: "elise", body: "Novagen is in for balances and calibration.", minutesAgo: 600 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Reports & moderation
// ---------------------------------------------------------------------------

export type ReportTarget =
  | { type: "POST"; postIndex: number }
  | { type: "LISTING"; listingIndex: number }
  | { type: "JOB"; jobIndex: number }
  | { type: "USER"; user: string }
  | { type: "COMMENT"; postIndex: number; commentIndex: number };

export interface SeedReport {
  reporter: string;
  target: ReportTarget;
  reason:
    | "SPAM"
    | "FRAUD_OR_SCAM"
    | "HARASSMENT"
    | "MISINFORMATION"
    | "FAKE_ACCOUNT"
    | "HATEFUL_SPEECH";
  reasonDetail?: string;
  status: "PENDING" | "UNDER_REVIEW" | "RESOLVED";
  daysAgo: number;
  /** Moderation applied when the report was resolved. */
  action?: { by: string; action: "WARN" | "SUSPEND" | "BAN" | "REMOVE_CONTENT" | "DISMISS"; note: string };
}

export const REPORTS: SeedReport[] = [
  {
    reporter: "marcus",
    target: { type: "POST", postIndex: 13 },
    reason: "FRAUD_OR_SCAM",
    reasonDetail: "Unrealistic prices and bank-transfer-only payment.",
    status: "RESOLVED",
    daysAgo: 21,
    action: { by: "moderator", action: "WARN", note: "Final warning for scam-like post." },
  },
  {
    reporter: "pieter",
    target: { type: "LISTING", listingIndex: 15 },
    reason: "FRAUD_OR_SCAM",
    reasonDetail: "Seller refuses viewings and asks for upfront transfer.",
    status: "RESOLVED",
    daysAgo: 20,
    action: { by: "admin", action: "BAN", note: "Repeated fraudulent listings — account banned." },
  },
  {
    reporter: "oliver",
    target: { type: "USER", user: "viktor" },
    reason: "FAKE_ACCOUNT",
    status: "RESOLVED",
    daysAgo: 19,
    action: { by: "moderator", action: "DISMISS", note: "Duplicate of an already-actioned report." },
  },
  {
    reporter: "elise",
    target: { type: "JOB", jobIndex: 8 },
    reason: "SPAM",
    reasonDetail: "Asks applicants for a registration fee.",
    status: "RESOLVED",
    daysAgo: 29,
    action: { by: "moderator", action: "SUSPEND", note: "Spam job and misleading ads — account suspended." },
  },
  {
    reporter: "anna",
    target: { type: "USER", user: "hannah" },
    reason: "HARASSMENT",
    reasonDetail: "Aggressive private messages after a disagreement.",
    status: "RESOLVED",
    daysAgo: 12,
    action: { by: "admin", action: "WARN", note: "First warning issued." },
  },
  {
    reporter: "lukas",
    target: { type: "USER", user: "hannah" },
    reason: "HARASSMENT",
    status: "RESOLVED",
    daysAgo: 8,
    action: { by: "admin", action: "SUSPEND", note: "Second harassment report — suspended pending appeal." },
  },
  {
    reporter: "sofia",
    target: { type: "POST", postIndex: 10 },
    reason: "MISINFORMATION",
    reasonDetail: "Image may not be the poster's own work.",
    status: "RESOLVED",
    daysAgo: 11,
    action: { by: "moderator", action: "WARN", note: "Asked to credit image source." },
  },
  {
    reporter: "katrin",
    target: { type: "LISTING", listingIndex: 9 },
    reason: "MISINFORMATION",
    reasonDetail: "Listed as a working balance?",
    status: "UNDER_REVIEW",
    daysAgo: 3,
  },
  {
    reporter: "thomas",
    target: { type: "COMMENT", postIndex: 5, commentIndex: 1 },
    reason: "SPAM",
    reasonDetail: "Supplier self-promotion in replies.",
    status: "PENDING",
    daysAgo: 1,
  },
  {
    reporter: "chiara",
    target: { type: "USER", user: "ravi" },
    reason: "SPAM",
    reasonDetail: "Sent unsolicited sales messages.",
    status: "PENDING",
    daysAgo: 2,
  },
];

/**
 * Moderation actions taken directly from the admin user list (no report).
 * Together with report actions these must add up to each user's
 * `status` and `warnings` in PEOPLE.
 */
export const ADMIN_ACTIONS: {
  by: string;
  target: string;
  action: "WARN" | "SUSPEND" | "DISMISS";
  note: string;
  daysAgo: number;
}[] = [
  { by: "moderator", target: "viktor", action: "WARN", note: "Misleading marketplace pricing.", daysAgo: 40 },
  { by: "moderator", target: "ravi", action: "WARN", note: "Unsolicited promotional messages.", daysAgo: 33 },
  { by: "admin", target: "thomas", action: "SUSPEND", note: "Suspected shared account.", daysAgo: 60 },
  { by: "admin", target: "thomas", action: "DISMISS", note: "Account re-activated after appeal.", daysAgo: 55 },
];

// ---------------------------------------------------------------------------
// App settings (pricing shape matches src/modules/admin/settings/settings.pricing.ts)
// ---------------------------------------------------------------------------

export const APP_SETTINGS: Record<string, unknown> = {
  subscription_pricing: { monthly: 19.99, yearly: 239.88 },
  sponsored_pricing: [
    { id: "7-days", label: "7 Days", price: 35 },
    { id: "14-days", label: "14 Days", price: 60 },
    { id: "30-days", label: "30 Days", price: 100 },
  ],
  marketplace_categories: [
    "Chromatography",
    "Spectroscopy",
    "Incubation",
    "Centrifugation",
    "Weighing",
    "Safety",
    "Consumables",
    "Microscopy",
    "Other",
  ],
  general_categories: ["News", "Document"],
};

/** Sample PDFs written to <UPLOAD_DIR>/seed/ and served from /uploads/seed/. */
export const SEED_DOCUMENTS: Record<string, string> = {
  "amr-surveillance-q2.pdf": "AMR Surveillance Report - Q2 2026",
  "iso17025-checklist.pdf": "ISO/IEC 17025 Transition Checklist",
  "lab-safety-checklist.pdf": "Laboratory Safety Checklist - 2026 Edition",
  "equipment-qualification-template.pdf": "Equipment Qualification (IQ/OQ/PQ) Protocol",
  "gcms-service-report.pdf": "GC-MS Service Report - BauerLab Instruments",
  "lusolab-price-list.pdf": "LusoLab Supplies - Price List 2026",
};
