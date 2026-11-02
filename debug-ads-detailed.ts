import { PrismaClient, AdStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const allAds = await prisma.advertisement.findMany({
    where: { status: AdStatus.ACTIVE },
    include: {
      supplier: { include: { profile: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`\nACTIVE ads (all ${allAds.length}):\n`);
  
  const now = new Date();
  allAds.forEach((ad) => {
    const hasImage = !!ad.imageUrl;
    const hasVideo = !!ad.videoUrl;
    const hasContent = ad.title && ad.description;
    const startOk = !ad.startDate || ad.startDate <= now;
    const expiryOk = !ad.expiryDate || ad.expiryDate > now;
    
    const eligible = hasContent && (hasImage || hasVideo) && startOk && expiryOk;
    
    console.log(`${eligible ? '✓' : '✗'} ${ad.title}`);
    console.log(`  ID: ${ad.id}`);
    console.log(`  Has title: ${!!ad.title} | Description: ${!!ad.description} | Content OK: ${hasContent}`);
    console.log(`  Has image: ${hasImage} | Has video: ${hasVideo} | Media OK: ${hasImage || hasVideo}`);
    console.log(`  Start: ${ad.startDate ? ad.startDate.toISOString() : 'null'} | Start OK: ${startOk}`);
    console.log(`  Expiry: ${ad.expiryDate ? ad.expiryDate.toISOString() : 'null'} | Expiry OK: ${expiryOk}`);
    console.log();
  });

  await prisma.$disconnect();
}

main().catch(console.error);
