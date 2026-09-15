import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { NotFoundError } from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";

export const notificationsService = {
  async list(
    userId: string,
    query: {
      page: number;
      pageSize: number;
      sort: "asc" | "desc";
      unread?: boolean;
    },
  ) {
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unread ? { read: false } : {}),
    };

    const [rows, total, unreadCount] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, read: false } }),
    ]);

    return {
      data: rows,
      meta: {
        ...buildPaginationMeta(query.page, query.pageSize, total),
        unreadCount,
      },
    };
  },

  async markRead(userId: string, id: string) {
    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!notification) throw new NotFoundError("Notification not found");
    return prisma.notification.update({ where: { id }, data: { read: true } });
  },

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  },

  async remove(userId: string, id: string) {
    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!notification) throw new NotFoundError("Notification not found");
    await prisma.notification.delete({ where: { id } });
  },
};
