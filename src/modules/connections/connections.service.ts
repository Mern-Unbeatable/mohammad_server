import { ConnectionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { serializeProfile } from "@/shared/serializers/user.serializer";
import type { ContactListQuery } from "./connections.validators";

const contactInclude = { profile: true } satisfies Prisma.UserInclude;

const serializeContact = (
  user: Prisma.UserGetPayload<{ include: typeof contactInclude }>,
  status: ConnectionStatus | null,
  direction: "incoming" | "outgoing" | null,
) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  ...(user.profile ? serializeProfile(user.profile) : {}),
  connectionStatus: status,
  connectionDirection: direction,
});

export const connectionsService = {
  /** Directory of other members with the caller's connection state annotated. */
  async listContacts(userId: string, query: ContactListQuery) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    const where: Prisma.UserWhereInput = {
      id: { not: userId },
      status: "ACTIVE",
      ...(query.country ? { profile: { country: query.country } } : {}),
      ...(query.search
        ? {
            OR: [
              {
                profile: {
                  firstName: { contains: query.search, mode: "insensitive" },
                },
              },
              {
                profile: {
                  lastName: { contains: query.search, mode: "insensitive" },
                },
              },
              {
                profile: {
                  company: { contains: query.search, mode: "insensitive" },
                },
              },
              {
                profile: {
                  title: { contains: query.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        include: contactInclude,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);

    const connections = await prisma.connection.findMany({
      where: {
        OR: [
          { requesterId: userId, addresseeId: { in: rows.map((r) => r.id) } },
          { addresseeId: userId, requesterId: { in: rows.map((r) => r.id) } },
        ],
      },
    });

    const map = new Map<
      string,
      { status: ConnectionStatus; direction: "incoming" | "outgoing" }
    >();
    for (const c of connections) {
      const otherId = c.requesterId === userId ? c.addresseeId : c.requesterId;
      map.set(otherId, {
        status: c.status,
        direction: c.requesterId === userId ? "outgoing" : "incoming",
      });
    }

    return {
      data: rows.map((r) => {
        const rel = map.get(r.id);
        return serializeContact(r, rel?.status ?? null, rel?.direction ?? null);
      }),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getContact(userId: string, contactId: string) {
    const user = await prisma.user.findUnique({
      where: { id: contactId },
      include: contactInclude,
    });
    if (!user) throw new NotFoundError("Contact not found");

    const connection = await prisma.connection.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: contactId },
          { requesterId: contactId, addresseeId: userId },
        ],
      },
    });

    const direction = connection
      ? connection.requesterId === userId
        ? "outgoing"
        : "incoming"
      : null;
    return serializeContact(user, connection?.status ?? null, direction);
  },

  async requestConnection(requesterId: string, addresseeId: string) {
    if (requesterId === addresseeId) {
      throw new BadRequestError("You cannot connect with yourself");
    }
    const target = await prisma.user.findUnique({ where: { id: addresseeId } });
    if (!target) throw new NotFoundError("User not found");

    const existing = await prisma.connection.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });
    if (existing) {
      throw new ConflictError(
        "A connection already exists between these users",
      );
    }

    const connection = await prisma.connection.create({
      data: { requesterId, addresseeId, status: ConnectionStatus.PENDING },
    });

    await prisma.notification.create({
      data: {
        userId: addresseeId,
        type: "CONNECTION_REQUEST",
        title: "New connection request",
        subtitle: "Someone wants to connect with you",
        link: `/contacts/${requesterId}`,
      },
    });

    return connection;
  },

  async respondToConnection(
    userId: string,
    connectionId: string,
    accept: boolean,
  ) {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) throw new NotFoundError("Connection request not found");
    if (connection.addresseeId !== userId) {
      throw new BadRequestError(
        "You can only respond to requests addressed to you",
      );
    }
    if (connection.status !== ConnectionStatus.PENDING) {
      throw new BadRequestError("This request has already been handled");
    }

    const status = accept
      ? ConnectionStatus.ACCEPTED
      : ConnectionStatus.DECLINED;

    const [updated] = await prisma.$transaction([
      prisma.connection.update({
        where: { id: connectionId },
        data: { status },
      }),
      ...(accept
        ? [
            prisma.profile.updateMany({
              where: {
                userId: {
                  in: [connection.requesterId, connection.addresseeId],
                },
              },
              data: { connectionsCount: { increment: 1 } },
            }),
            prisma.notification.create({
              data: {
                userId: connection.requesterId,
                type: "CONNECTION_ACCEPTED",
                title: "Connection accepted",
                subtitle: "Your connection request was accepted",
                link: `/contacts/${connection.addresseeId}`,
              },
            }),
          ]
        : []),
    ]);

    return updated;
  },

  async removeConnection(userId: string, connectionId: string) {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) throw new NotFoundError("Connection not found");
    if (
      connection.requesterId !== userId &&
      connection.addresseeId !== userId
    ) {
      throw new BadRequestError("You are not part of this connection");
    }

    await prisma.$transaction([
      prisma.connection.delete({ where: { id: connectionId } }),
      ...(connection.status === ConnectionStatus.ACCEPTED
        ? [
            prisma.profile.updateMany({
              where: {
                userId: {
                  in: [connection.requesterId, connection.addresseeId],
                },
              },
              data: { connectionsCount: { decrement: 1 } },
            }),
          ]
        : []),
    ]);
  },
};
