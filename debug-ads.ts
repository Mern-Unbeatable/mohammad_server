/**
 * Debug script: Query the database for active advertisements
 * and verify the distribution logic
 */
import { PrismaClient, AdStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("\n=== ADVERTISEMENT DATABASE AUDIT ===\n");

  // Query all ads
  const allAds = await prisma.advertisement.findMany({
    include: {
      supplier: { include: { profile: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Total advertisements in database: ${allAds.length}\n`);

  // Group by status
  const byStatus: Record<string, typeof allAds> = {};
  allAds.forEach((ad) => {
    if (!byStatus[ad.status]) byStatus[ad.status] = [];
    byStatus[ad.status].push(ad);
  });

  // Print by status
  Object.entries(byStatus).forEach(([status, ads]) => {
    console.log(`${status}: ${ads.length} ads`);
    ads.forEach((ad) => {
      console.log(`  - ${ad.title} (ID: ${ad.id}) [${ad.category}]`);
    });
    console.log();
  });

  // Now check eligibility for feed
  const now = new Date();
  const isEligible = (ad: typeof allAds[0]): boolean => {
    // Must be ACTIVE
    if (ad.status !== AdStatus.ACTIVE) return false;
    // Start date must have passed (or be null)
    if (ad.startDate && ad.startDate > now) return false;
    // Expiry date must not have passed (or be null)
    if (ad.expiryDate && ad.expiryDate <= now) return false;
    // Must have valid display content
    if (!ad.title || !ad.description) return false;
    // Must have at least image or video
    if (!ad.imageUrl && !ad.videoUrl) return false;
    return true;
  };

  const eligibleAds = allAds.filter(isEligible);
  console.log(`\n=== FEED ELIGIBILITY ===\n`);
  console.log(`Eligible for feed: ${eligibleAds.length} ads\n`);
  eligibleAds.forEach((ad, idx) => {
    console.log(`${idx + 1}. ${ad.title} (ID: ${ad.id})`);
    console.log(`   Status: ${ad.status}`);
    console.log(`   Category: ${ad.category}`);
    console.log(`   Has image: ${!!ad.imageUrl}`);
    console.log(`   Has video: ${!!ad.videoUrl}`);
    console.log(`   Start date: ${ad.startDate ? ad.startDate.toISOString() : "null"}`);
    console.log(`   Expiry date: ${ad.expiryDate ? ad.expiryDate.toISOString() : "null"}`);
    console.log();
  });

  // Simulate distribution
  console.log(`=== DISTRIBUTION SPLIT (First 3 sidebar, rest in feed) ===\n`);
  const sidebarAds = eligibleAds.slice(0, 3);
  const feedAds = eligibleAds.slice(3);

  console.log(`Sidebar (first 3):`);
  sidebarAds.forEach((ad) => {
    console.log(`  ✓ ${ad.title} (ID: ${ad.id})`);
  });

  console.log(`\nFeed (remainder):`);
  if (feedAds.length === 0) {
    console.log(`  (none)`);
  } else {
    feedAds.forEach((ad) => {
      console.log(`  ✓ ${ad.title} (ID: ${ad.id})`);
    });
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total eligible: ${eligibleAds.length}`);
  console.log(`Sidebar: ${sidebarAds.length}`);
  console.log(`Feed: ${feedAds.length}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
