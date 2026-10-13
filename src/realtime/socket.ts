import type { Server as HttpServer } from "node:http";
import { Server, Socket } from "socket.io";
import { Role, UserStatus } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/config/logger";
import { onNotificationsCreated, prisma } from "@/infrastructure/prisma";
import { verifyAccessToken } from "@/shared/utils/jwt";

interface SocketUser {
  id: string;
  role: Role;
}

type AuthedSocket = Socket & { data: { user: SocketUser } };

let io: Server | null = null;

/**
 * Presence is tracked in memory per process. Running several API instances
 * requires a shared adapter (e.g. @socket.io/redis-adapter) and shared presence.
 */
const connectionCounts = new Map<string, number>();

const userRoom = (userId: string) => `user:${userId}`;

export const isUserOnline = (userId: string): boolean =>
  (connectionCounts.get(userId) ?? 0) > 0;

/** Users who share at least one conversation with `userId`. */
const conversationPartnerIds = async (userId: string): Promise<string[]> => {
  const rows = await prisma.conversationParticipant.findMany({
    where: {
      userId: { not: userId },
      conversation: { participants: { some: { userId } } },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((row) => row.userId);
};

const broadcastPresence = async (userId: string, online: boolean) => {
  if (!io) return;
  const partners = await conversationPartnerIds(userId);
  if (partners.length === 0) return;
  io.to(partners.map(userRoom)).emit("presence:update", { userId, online });
};

export const emitToUsers = (
  userIds: string[],
  event: string,
  payload: unknown,
): void => {
  if (!io || userIds.length === 0) return;
  io.to(Array.from(new Set(userIds)).map(userRoom)).emit(event, payload);
};

export const initRealtime = (httpServer: HttpServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins.length ? env.corsOrigins : true,
      credentials: true,
    },
  });

  onNotificationsCreated((userIds) => emitToUsers(userIds, "notification:new", {}));

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token) {
      next(new Error("UNAUTHENTICATED"));
      return;
    }
    try {
      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, status: true },
      });
      if (!user) {
        next(new Error("UNAUTHENTICATED"));
        return;
      }
      if (user.status !== UserStatus.ACTIVE) {
        next(new Error("FORBIDDEN"));
        return;
      }
      (socket as AuthedSocket).data.user = { id: user.id, role: user.role };
      next();
    } catch {
      next(new Error("UNAUTHENTICATED"));
    }
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as AuthedSocket;
    const { id: userId } = socket.data.user;

    void socket.join(userRoom(userId));

    const count = (connectionCounts.get(userId) ?? 0) + 1;
    connectionCounts.set(userId, count);
    if (count === 1) {
      broadcastPresence(userId, true).catch((err) =>
        logger.warn({ err }, "Failed to broadcast presence"),
      );
    }

    socket.on("presence:query", async (userIds: unknown, ack: unknown) => {
      if (typeof ack !== "function") return;
      const requested = Array.isArray(userIds)
        ? userIds.filter((id): id is string => typeof id === "string").slice(0, 500)
        : [];
      try {
        const partners = new Set(await conversationPartnerIds(userId));
        ack(requested.filter((id) => partners.has(id) && isUserOnline(id)));
      } catch (err) {
        logger.warn({ err }, "Presence query failed");
        ack([]);
      }
    });

    socket.on("disconnect", () => {
      const remaining = (connectionCounts.get(userId) ?? 1) - 1;
      if (remaining > 0) {
        connectionCounts.set(userId, remaining);
        return;
      }
      connectionCounts.delete(userId);
      broadcastPresence(userId, false).catch((err) =>
        logger.warn({ err }, "Failed to broadcast presence"),
      );
    });
  });

  return io;
};

export const closeRealtime = async (): Promise<void> => {
  if (!io) return;
  await io.close();
  io = null;
};
