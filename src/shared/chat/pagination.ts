import type { Prisma } from "@prisma/client";
import { encodeCursor, olderThan, type KeysetCursor } from "@/shared/http/cursor";

/** Newest first, ties broken by id so equal timestamps page deterministically. */
export const MESSAGE_PAGE_ORDER = [
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.MessageOrderByWithRelationInput[];

export const CONVERSATION_PAGE_ORDER = [
  { updatedAt: "desc" },
  { id: "desc" },
] satisfies Prisma.ConversationOrderByWithRelationInput[];

/**
 * Messages older than the oldest one the client holds. `beforeId` makes the
 * cursor exact; `before` alone (older clients) keeps the previous behaviour.
 */
export const olderMessagesWhere = (query: {
  before?: Date;
  beforeId?: string;
}): Prisma.MessageWhereInput => {
  if (!query.before) return {};
  if (!query.beforeId) return { createdAt: { lt: query.before } };
  return olderThan("createdAt", { at: query.before, id: query.beforeId });
};

/** Applies an optional keyset cursor on top of a list filter. */
export const conversationPageWhere = (
  where: Prisma.ConversationWhereInput,
  cursor?: KeysetCursor,
): Prisma.ConversationWhereInput =>
  cursor ? { AND: [where, olderThan("updatedAt", cursor)] } : where;

/** Cursor for the page after `rows` (null on the last page). */
export const nextConversationCursor = (
  rows: { id: string; updatedAt: Date }[],
  hasMore: boolean,
): string | null => {
  const last = rows[rows.length - 1];
  return hasMore && last ? encodeCursor({ at: last.updatedAt, id: last.id }) : null;
};
