import { Prisma, Role } from "@prisma/client";
import { env } from "@/config/env";

export const participantUserInclude = {
  user: { include: { profile: true } },
} satisfies Prisma.ConversationParticipantInclude;

export const conversationInclude = {
  participants: { include: participantUserInclude, orderBy: { createdAt: "asc" } },
  messages: { orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.ConversationInclude;

export type ConversationWithRelations = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

type UserWithProfile = Prisma.UserGetPayload<{ include: { profile: true } }>;

export interface MessageAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

/** One key per user pair, independent of who started the conversation. */
export const buildDirectKey = (a: string, b: string): string =>
  [a, b].sort().join(":");

export const displayNameOf = (user: UserWithProfile): string => {
  const full = user.profile
    ? `${user.profile.firstName} ${user.profile.lastName}`.trim()
    : "";
  return full || user.email;
};

export const initialsOf = (user: UserWithProfile): string => {
  if (user.profile?.initials) return user.profile.initials;
  const first = user.profile?.firstName?.[0] ?? user.email[0] ?? "";
  const last = user.profile?.lastName?.[0] ?? "";
  return `${first}${last}`.toUpperCase();
};

export const subtitleOf = (user: UserWithProfile): string | null => {
  const parts = [user.profile?.title, user.profile?.company].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
};

/** Frontend chat base route for a given role (mirrors web `CHAT_BASE_PATHS`). */
export const messagesPathForRole = (role: Role): string => {
  if (role === Role.SUPPLIER) return "/supplier/chat";
  if (role === Role.ADMIN) return "/admin/chat";
  return "/chat";
};

export type ChatTarget =
  | { isGroup: true; conversationId: string }
  | { isGroup: false; otherUserId: string };

/** Direct chats are addressed by the other user's id, groups by conversation id. */
export const chatPathSuffix = (target: ChatTarget): string =>
  target.isGroup
    ? `/group/${target.conversationId}`
    : `/messages/${target.otherUserId}`;

export const messagesLinkFor = (role: Role, target: ChatTarget): string =>
  `${messagesPathForRole(role)}${chatPathSuffix(target)}`;

export const truncate = (text: string, max = 120): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Attachments must reference files previously uploaded to this server. */
export const isOwnUploadUrl = (url: string): boolean =>
  url.startsWith(`${env.upload.publicUrl}/${env.upload.dir}/`);

export const parseAttachments = (value: Prisma.JsonValue): MessageAttachment[] =>
  Array.isArray(value) ? (value as unknown as MessageAttachment[]) : [];

export const previewOf = (
  message:
    | { body: string; attachments: Prisma.JsonValue; listingId?: string | null }
    | undefined,
): string | null => {
  if (!message) return null;
  if (message.body) return message.body;
  const count = parseAttachments(message.attachments).length;
  if (count === 0) return message.listingId ? "Shared a listing" : null;
  return count === 1 ? "Sent an attachment" : `Sent ${count} attachments`;
};

export const serializeParticipant = (
  participant: ConversationWithRelations["participants"][number],
) => ({
  id: participant.userId,
  name: displayNameOf(participant.user),
  initials: initialsOf(participant.user),
  avatar: participant.user.profile?.avatarUrl ?? null,
  subtitle: subtitleOf(participant.user),
  role: participant.role,
  userRole: participant.user.role,
  lastReadAt: participant.lastReadAt,
});

export const serializeConversation = (
  conversation: ConversationWithRelations,
  userId: string,
  unreadCount = 0,
) => {
  const others = conversation.participants.filter((p) => p.userId !== userId);
  const self = conversation.participants.find((p) => p.userId === userId);
  const primary = others[0]?.user;
  const lastMessage = conversation.messages[0];

  const groupName = conversation.name ?? "Group";

  return {
    id: conversation.id,
    isGroup: conversation.isGroup,
    name: conversation.isGroup
      ? groupName
      : primary
        ? displayNameOf(primary)
        : "Former member",
    subtitle: conversation.isGroup
      ? `${conversation.participants.length} members`
      : primary
        ? subtitleOf(primary)
        : null,
    initials: conversation.isGroup
      ? groupName.slice(0, 2).toUpperCase()
      : primary
        ? initialsOf(primary)
        : "?",
    avatar: conversation.isGroup ? null : (primary?.profile?.avatarUrl ?? null),
    otherUserId: conversation.isGroup ? null : (primary?.id ?? null),
    otherUserRole: conversation.isGroup ? null : (primary?.role ?? null),
    preview: previewOf(lastMessage),
    time: lastMessage?.createdAt ?? conversation.updatedAt,
    unreadCount,
    myRole: self?.role ?? null,
    lastReadAt: self?.lastReadAt ?? null,
    participants: conversation.participants.map(serializeParticipant),
  };
};

export const messageInclude = {
  sender: { include: { profile: true } },
  listing: {
    select: { id: true, title: true, price: true, images: true, status: true, sellerId: true },
  },
} satisfies Prisma.MessageInclude;

type MessageWithRelations = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

/** Live listing card data; null when none was shared or the listing was deleted. */
export const serializeMessageListing = (listing: MessageWithRelations["listing"]) =>
  listing
    ? {
        id: listing.id,
        title: listing.title,
        price: listing.price / 100,
        image: listing.images[0] ?? null,
        status: listing.status,
        sellerId: listing.sellerId,
      }
    : null;

/** Group activity recorded as a SYSTEM message; names are captured when it happens. */
export type SystemEvent =
  | { action: "created"; name: string; targetIds: string[]; targetNames: string[] }
  | { action: "added" | "removed"; targetIds: string[]; targetNames: string[] }
  | { action: "left" }
  | { action: "renamed"; name: string };

/** "Anna", "Anna and Ben", "Anna, Ben and Cara", "Anna, Ben and 3 others". */
export const joinNames = (names: string[], max = 3): string => {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  const rest = names.length - (max - 1);
  return `${names.slice(0, max - 1).join(", ")} and ${rest} others`;
};

/** Third-person notice stored as the message body (list previews, clients without event support). */
export const systemEventText = (actorName: string, event: SystemEvent): string => {
  switch (event.action) {
    case "created":
      return event.targetNames.length
        ? `${actorName} created the group "${event.name}" and added ${joinNames(event.targetNames)}`
        : `${actorName} created the group "${event.name}"`;
    case "added":
      return `${actorName} added ${joinNames(event.targetNames)}`;
    case "removed":
      return `${actorName} removed ${joinNames(event.targetNames)}`;
    case "left":
      return `${actorName} left the group`;
    case "renamed":
      return `${actorName} renamed the group to "${event.name}"`;
  }
};

export const serializeMessage = (message: MessageWithRelations, userId: string) => ({
  id: message.id,
  conversationId: message.conversationId,
  type: message.type,
  event: message.event ?? null,
  body: message.body,
  attachments: parseAttachments(message.attachments),
  listing: serializeMessageListing(message.listing),
  from: message.senderId === userId ? ("me" as const) : ("them" as const),
  senderId: message.senderId,
  sender: displayNameOf(message.sender),
  senderAvatar: message.sender.profile?.avatarUrl ?? null,
  senderInitials: initialsOf(message.sender),
  time: message.createdAt,
});
