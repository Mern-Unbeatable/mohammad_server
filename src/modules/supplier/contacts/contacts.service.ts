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
import type { ContactListQuery } from "./contacts.validators";

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

/** Country + free-text filters applied to the member being listed. */
const memberFilter = (
  query: Pick<ContactListQuery, "country" | "search">,
): Prisma.UserWhereInput => ({
  ...(query.country ? { profile: { country: query.country } } : {}),
  ...(query.search
    ? {
        OR: (["firstName", "lastName", "company", "title"] as const).map(
          (field) => ({
            profile: {
              [field]: { contains: query.search, mode: "insensitive" },
            },
          }),
        ),
      }
    : {}),
});

export const contactsService = {
  /**
   * Directory of other members not yet connected to the caller, annotated with
   * any pending/declined connection. Accepted connections are listed via
   * `status=accepted` instead.
   */
  async listContacts(userId: string, query: ContactListQuery) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    // Pending/accepted/declined inbox: list from Connection rows, not full directory.
    if (query.status) {
      const statusMap = {
        pending: ConnectionStatus.PENDING,
        accepted: ConnectionStatus.ACCEPTED,
        declined: ConnectionStatus.DECLINED,
      } as const;
      const connectionStatus = statusMap[query.status];
      const other = memberFilter(query);

      // Filters apply to the other side of the connection, not the caller.
      const where: Prisma.ConnectionWhereInput = {
        status: connectionStatus,
        OR: [
          ...(query.direction === "outgoing"
            ? []
            : [{ addresseeId: userId, requester: other }]),
          ...(query.direction === "incoming"
            ? []
            : [{ requesterId: userId, addressee: other }]),
        ],
      };

      const [rows, total] = await prisma.$transaction([
        prisma.connection.findMany({
          where,
          include: {
            requester: { include: { profile: true } },
            addressee: { include: { profile: true } },
          },
          // `id` breaks createdAt ties so offset pages never overlap or skip rows.
          orderBy: [{ createdAt: query.sort }, { id: query.sort }],
          skip,
          take,
        }),
        prisma.connection.count({ where }),
      ]);

      return {
        data: rows.map((c) => {
          const other =
            c.requesterId === userId ? c.addressee : c.requester;
          const direction =
            c.requesterId === userId ? "outgoing" : "incoming";
          return {
            ...serializeContact(other, c.status, direction),
            connectionId: c.id,
          };
        }),
        meta: buildPaginationMeta(query.page, query.pageSize, total),
      };
    }

    const where: Prisma.UserWhereInput = {
      id: { not: userId },
      status: "ACTIVE",
      // Either side may have sent the accepted request.
      sentConnections: {
        none: { addresseeId: userId, status: ConnectionStatus.ACCEPTED },
      },
      receivedConnections: {
        none: { requesterId: userId, status: ConnectionStatus.ACCEPTED },
      },
      ...memberFilter(query),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        include: contactInclude,
        orderBy: [{ createdAt: query.sort }, { id: query.sort }],
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
      {
        status: ConnectionStatus;
        direction: "incoming" | "outgoing";
        connectionId: string;
      }
    >();
    for (const c of connections) {
      const otherId = c.requesterId === userId ? c.addresseeId : c.requesterId;
      map.set(otherId, {
        status: c.status,
        direction: c.requesterId === userId ? "outgoing" : "incoming",
        connectionId: c.id,
      });
    }

    return {
      data: rows.map((r) => {
        const rel = map.get(r.id);
        return {
          ...serializeContact(r, rel?.status ?? null, rel?.direction ?? null),
          connectionId: rel?.connectionId ?? null,
        };
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
