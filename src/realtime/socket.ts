import type { Server as HttpServer } from "node:http";
import { Server, Socket } from "socket.io";
import { Role, UserStatus } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/config/logger";
import { onNotificationsCreated, prisma } from "@/infrastructure/prisma";
import { verifyAccessToken } from "@/shared/utils/jwt";
import { createTypingThrottle } from "./typingThrottle";

interface SocketUser {
  id: string;
  role: Role;
  /** Access-token expiry (seconds since epoch) presented at handshake. */
  tokenExp: number | null;
}

type AuthedSocket = Socket & { data: { user: SocketUser } };

let io: Server | null = null;
let sweepTimer: NodeJS.Timeout | null = null;

/** How often open sockets are re-checked against account status and token expiry. */
export const SESSION_SWEEP_MS = 60_000;

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

/**
 * Ends every open socket of `userId` (e.g. after a suspension or ban) so it
 * stops receiving events. A `session:revoked` notice precedes the disconnect;
 * clients must not reconnect after it.
 */
export const disconnectUser = (userId: string): void => {
  if (!io) return;
  const room = io.in(userRoom(userId));
  room.emit("session:revoked", {});
  room.disconnectSockets();
};

/**
 * Re-validates long-lived sockets: inactive accounts are dropped with
 * `session:revoked`; sockets whose access token has expired get
 * `session:expired` so the client refreshes its token and reconnects.
 */
export const revalidateSessions = async (now = Date.now()): Promise<void> => {
  if (!io) return;
  const sockets = await io.fetchSockets();
  if (sockets.length === 0) return;

  const ids = Array.from(
    new Set(sockets.map((socket) => (socket.data as { user: SocketUser }).user.id)),
  );
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true },
  });
  const active = new Set(
    users.filter((user) => user.status === UserStatus.ACTIVE).map((user) => user.id),
  );

  for (const socket of sockets) {
    const { id, tokenExp } = (socket.data as { user: SocketUser }).user;
    if (!active.has(id)) {
      socket.emit("session:revoked", {});
      socket.disconnect();
    } else if (tokenExp !== null && tokenExp * 1000 <= now) {
      socket.emit("session:expired", {});
      socket.disconnect();
    }
  }
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
      const exp = (payload as { exp?: unknown }).exp;
      (socket as AuthedSocket).data.user = {
        id: user.id,
        role: user.role,
        tokenExp: typeof exp === "number" ? exp : null,
      };
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

    // Relays "typing" to the other participants. Throttled here as well as
    // on the client, before the membership lookup hits the database.
    const allowTyping = createTypingThrottle();
    socket.on("typing", async (payload: unknown) => {
      const { conversationId, typing } = (payload ?? {}) as {
        conversationId?: unknown;
        typing?: unknown;
      };
      if (typeof conversationId !== "string" || !conversationId) return;
      if (conversationId.length > 64) return;
      if (!allowTyping(conversationId, typing === true)) return;
      try {
        const participants = await prisma.conversationParticipant.findMany({
          where: { conversationId },
          select: { userId: true },
        });
        const ids = participants.map((p) => p.userId);
        if (!ids.includes(userId)) return;
        emitToUsers(
          ids.filter((id) => id !== userId),
          "typing",
          { conversationId, userId, typing: typing === true },
        );
      } catch (err) {
        logger.warn({ err }, "Typing relay failed");
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

  sweepTimer = setInterval(() => {
    revalidateSessions().catch((err) =>
      logger.warn({ err }, "Socket session revalidation failed"),
    );
  }, SESSION_SWEEP_MS);
  sweepTimer.unref();

  return io;
};

export const closeRealtime = async (): Promise<void> => {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  if (!io) return;
  await io.close();
  io = null;
};
