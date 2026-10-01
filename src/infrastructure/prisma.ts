import { PrismaClient } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/config/logger";

type NotificationsCreatedListener = (userIds: string[]) => void;

let notificationsCreatedListener: NotificationsCreatedListener | null = null;

/** Registered by the realtime layer to push `notification:new` to recipients. */
export const onNotificationsCreated = (listener: NotificationsCreatedListener): void => {
  notificationsCreatedListener = listener;
};

/** Recipient ids from `notification.create` / `createMany` data (checked or unchecked input). */
const recipientIdsOf = (data: unknown): string[] =>
  (Array.isArray(data) ? data : [data]).flatMap((row) => {
    const input = row as { userId?: unknown; user?: { connect?: { id?: unknown } } } | null;
    const id = input?.userId ?? input?.user?.connect?.id;
    return typeof id === "string" ? [id] : [];
  });

const announceNotifications = (data: unknown) => {
  const userIds = recipientIdsOf(data);
  if (userIds.length === 0 || !notificationsCreatedListener) return;
  try {
    notificationsCreatedListener(userIds);
  } catch (err) {
    logger.warn({ err }, "Failed to announce new notifications");
  }
};

/**
 * Single shared Prisma client. Reused across the app to avoid exhausting the
 * database connection pool during development hot-reloads.
 *
 * Every notification insert is announced after the query resolves, so all
 * services get realtime badges without calling the socket layer themselves.
 * Inside an interactive `$transaction(async (tx) => …)` that is before commit.
 */
export const prisma = new PrismaClient({
  log: env.isProduction ? ["warn", "error"] : ["warn", "error"],
}).$extends({
  name: "notification-events",
  query: {
    notification: {
      async create({ args, query }) {
        const result = await query(args);
        announceNotifications(args.data);
        return result;
      },
      async createMany({ args, query }) {
        const result = await query(args);
        announceNotifications(args.data);
        return result;
      },
    },
  },
});

export const connectDatabase = async (): Promise<void> => {
  await prisma.$connect();
  logger.info("Database connection established");
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  logger.info("Database connection closed");
};
