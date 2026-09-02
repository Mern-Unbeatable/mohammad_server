import { PrismaClient } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/config/logger";

/**
 * Single shared Prisma client. Reused across the app to avoid exhausting the
 * database connection pool during development hot-reloads.
 */
export const prisma = new PrismaClient({
  log: env.isProduction ? ["warn", "error"] : ["warn", "error"],
});

export const connectDatabase = async (): Promise<void> => {
  await prisma.$connect();
  logger.info("Database connection established");
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  logger.info("Database connection closed");
};
