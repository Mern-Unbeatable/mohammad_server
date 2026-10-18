import { z } from "zod";
import { isOwnUploadUrl } from "./messages.helpers";

export const conversationListQuerySchema = z.object({
  type: z.enum(["direct", "group"]).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(30),
});

export const recipientsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  /** A specific user to return even when the search or page size would leave them out (e.g. from a profile's Message button). */
  include: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export const attachmentSchema = z.object({
  url: z
    .string()
    .url()
    .max(2000)
    .refine(isOwnUploadUrl, "Attachments must be uploaded through /uploads"),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150),
  size: z.coerce.number().int().nonnegative(),
});

/** Marketplace listing the message is about. */
const listingIdSchema = z.string().uuid().optional();

const messageContentSchema = z
  .object({
    body: z.string().trim().max(5000).default(""),
    attachments: z.array(attachmentSchema).max(10).default([]),
    listingId: listingIdSchema,
  })
  .refine(
    (value) =>
      value.body.length > 0 || value.attachments.length > 0 || Boolean(value.listingId),
    {
      message: "A message needs text, an attachment or a listing",
      path: ["body"],
    },
  );

export const startDirectSchema = z
  .object({
    participantId: z.string().uuid(),
    message: z.string().trim().max(5000).default(""),
    listingId: listingIdSchema,
  })
  .refine((value) => value.message.length > 0 || Boolean(value.listingId), {
    message: "Message is required",
    path: ["message"],
  });

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(160),
  participantIds: z.array(z.string().uuid()).min(1).max(256),
});

export const sendMessageSchema = messageContentSchema;

export const editMessageSchema = z.object({
  body: z.string().trim().max(5000),
});

export const renameGroupSchema = z.object({
  name: z.string().trim().min(1).max(160),
});

export const addParticipantsSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(256),
});

export const conversationIdParamSchema = z.object({ id: z.string().uuid() });

export const directUserParamSchema = z.object({ userId: z.string().uuid() });

export const messageIdParamSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const participantParamSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

export const messageListQuerySchema = z.object({
  before: z.coerce.date().optional(),
  pageSize: z.coerce.number().int().positive().max(100).default(30),
});

export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;
export type RecipientsQuery = z.infer<typeof recipientsQuerySchema>;
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
export type MessageContent = z.infer<typeof messageContentSchema>;
