/**
 * Create a test user account for verification testing
 */
import { PrismaClient, Role, SubscriptionStatus, SubscriptionPlan } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const testEmail = "testuser.feed@example.com";
  const testPassword = "TestPassword123!";

  // Check if user already exists
  const existing = await prisma.user.findUnique({
    where: { email: testEmail },
  });

  if (existing) {
    console.log(`User ${testEmail} already exists`);
    console.log(`ID: ${existing.id}`);
    console.log(`To login: email="${testEmail}" password="${testPassword}"`);
    await prisma.$disconnect();
    return;
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(testPassword, 12);

  // Create user
  const user = await prisma.user.create({
    data: {
      email: testEmail,
      passwordHash: hashedPassword,
      role: Role.USER,
      status: "ACTIVE",
      profile: {
        create: {
          firstName: "Test",
          lastName: "User",
          company: "Lab Unity QA",
          country: "Belgium",
          location: "Brussels",
          about: "Test account for feed verification",
          initials: "TU",
        },
      },
      subscription: {
        create: {
          plan: SubscriptionPlan.MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          startDate: new Date(),
          renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          trialDaysLeft: 0,
          trialDaysTotal: 0,
        },
      },
    },
    include: {
      profile: true,
      subscription: true,
    },
  });

  console.log(`\n✓ Created test user:`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Password: ${testPassword}`);
  console.log(`  ID: ${user.id}`);
  console.log(`  Name: ${user.profile?.firstName} ${user.profile?.lastName}`);
  console.log(`  Role: ${user.role}`);
  console.log(`\nUse these credentials to login to ${process.env.CLIENT_URL || 'http://localhost:5173'}\n`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
