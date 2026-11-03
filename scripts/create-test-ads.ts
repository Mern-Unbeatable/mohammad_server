/**
 * Create 4 test ACTIVE advertisements for testing the feed distribution
 */
import { PrismaClient, AdStatus, AdCategory, AdPaymentStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find a supplier user
  const supplier = await prisma.user.findFirst({
    where: { role: "SUPPLIER" },
  });

  if (!supplier) {
    console.error("No supplier user found!");
    process.exit(1);
  }

  console.log(`Using supplier: ${supplier.id}`);

  // Clean up old test ads
  await prisma.advertisement.deleteMany({
    where: {
      title: {
        in: [
          "TEST AD 1: Premium Laboratory Equipment",
          "TEST AD 2: Advanced Microscopy System",
          "TEST AD 3: Sample Prep Services",
          "TEST AD 4: Equipment Maintenance Service",
        ],
      },
    },
  });

  // Create 4 test ads - all ACTIVE with future expiry
  const now = new Date();
  const futureExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

  const testAds = [
    {
      title: "TEST AD 1: Premium Laboratory Equipment",
      category: AdCategory.PRODUCT,
      description: "High-quality laboratory equipment with competitive pricing.",
      imageUrl: "https://images.unsplash.com/photo-1576086213369-97a306d36557?auto=format&fit=crop&w=800",
      price: 49900, // $499.00
      contact: "sales@testlabs.example",
      location: "New York, USA",
      status: AdStatus.ACTIVE,
      paymentStatus: AdPaymentStatus.PAID,
      startDate: now,
      expiryDate: futureExpiry,
      paidAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // paid yesterday
      supplierId: supplier.id,
    },
    {
      title: "TEST AD 2: Advanced Microscopy System",
      category: AdCategory.PRODUCT,
      description: "State-of-the-art microscopy equipment for research laboratories.",
      imageUrl: "https://images.unsplash.com/photo-1614308457932-e16d85c5d053?auto=format&fit=crop&w=800",
      price: 89500, // $895.00
      contact: "info@microscopylab.example",
      location: "Boston, USA",
      status: AdStatus.ACTIVE,
      paymentStatus: AdPaymentStatus.PAID,
      startDate: now,
      expiryDate: futureExpiry,
      paidAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      supplierId: supplier.id,
    },
    {
      title: "TEST AD 3: Sample Prep Services",
      category: AdCategory.SERVICE,
      description: "Professional sample preparation for analytical testing.",
      imageUrl: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=800",
      price: 15000, // $150.00 per service
      contact: "services@sampleprep.example",
      location: "San Francisco, USA",
      status: AdStatus.ACTIVE,
      paymentStatus: AdPaymentStatus.PAID,
      startDate: now,
      expiryDate: futureExpiry,
      paidAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      supplierId: supplier.id,
    },
    {
      title: "TEST AD 4: Equipment Maintenance Service",
      category: AdCategory.SERVICE,
      description: "On-site equipment maintenance and calibration services.",
      imageUrl: "https://images.unsplash.com/photo-1581093804475-577d72e38aa0?auto=format&fit=crop&w=800",
      price: 25000, // $250.00
      contact: "maintenance@labservices.example",
      location: "Chicago, USA",
      status: AdStatus.ACTIVE,
      paymentStatus: AdPaymentStatus.PAID,
      startDate: now,
      expiryDate: futureExpiry,
      paidAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      supplierId: supplier.id,
    },
  ];

  console.log(`\nCreating ${testAds.length} test ACTIVE ads...\n`);

  for (const adData of testAds) {
    const ad = await prisma.advertisement.create({
      data: adData,
    });
    console.log(`✓ Created: ${ad.title} (ID: ${ad.id})`);
  }

  console.log(`\nDone! Created 4 test ACTIVE advertisements.`);
  console.log(`All are eligible for the user feed.\n`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
