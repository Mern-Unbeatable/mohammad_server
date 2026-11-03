import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/config/logger";
import { prisma } from "@/infrastructure/prisma";
import { BadRequestError } from "@/shared/errors/AppError";
import { sanitizeOriginalName, typeForExtension } from "@/shared/files/fileType";
import { privateUploadRoot, publicUploadRoot } from "@/middleware/upload";

/**
 * Chat attachments are stored privately under `<privateDir>/chat/<ownerId>/`
 * and referenced from messages by key (`<ownerId>/<file>`). Clients only ever
 * receive short-lived signed links scoped to one conversation.
 *
 * Messages sent before this existed hold `{ url }` entries pointing at the
 * public uploads folder; those keep working unchanged.
 */
export interface StoredKeyAttachment {
  key: string;
  name: string;
  mimeType: string;
  size: number;
}
export interface LegacyUrlAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}
export type StoredAttachment = StoredKeyAttachment | LegacyUrlAttachment;

export interface PresentedAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

const KEY_PATTERN =
  /^[A-Za-z0-9-]{1,64}\/\d{10,16}-[0-9a-f]{16}\.(jpg|png|gif|webp|pdf|docx?|xlsx?|pptx?|mp4|mov)$/;

export const isAttachmentKey = (value: string): boolean => KEY_PATTERN.test(value);

export const chatUploadFolder = path.join(privateUploadRoot, "chat");

/** Absolute path of a stored attachment; only valid keys are ever resolved. */
export const attachmentPath = (key: string): string => {
  if (!isAttachmentKey(key)) throw new BadRequestError("Invalid attachment reference");
  return path.join(chatUploadFolder, ...key.split("/"));
};

export const keyFor = (ownerId: string, filename: string) => `${ownerId}/${filename}`;

const signingKey = (): Buffer =>
  env.upload.signingSecret
    ? Buffer.from(env.upload.signingSecret)
    : crypto.createHmac("sha256", env.jwt.accessSecret).update("chat-attachment-links").digest();

const signature = (conversationId: string, key: string, exp: number) =>
  crypto
    .createHmac("sha256", signingKey())
    .update(`${conversationId}\n${key}\n${exp}`)
    .digest("base64url");

/**
 * Expiry rounded to TTL buckets, so the same message yields the same link for
 * a while (stable for caching and React keys). Links live for 1–2 × TTL.
 */
export const linkExpiry = (now = Date.now()): number => {
  const ttl = env.upload.signedUrlTtlSeconds;
  return (Math.floor(now / 1000 / ttl) + 2) * ttl;
};

/** Served outside the API prefix so thread images do not consume the global API rate limit. */
export const ATTACHMENT_ROUTE_BASE = "/chat-attachments";

export const attachmentRoutePath = (conversationId: string, key: string) =>
  `${ATTACHMENT_ROUTE_BASE}/${conversationId}/${key}`;

export const signAttachmentUrl = (conversationId: string, key: string, now = Date.now()) => {
  const exp = linkExpiry(now);
  const sig = signature(conversationId, key, exp);
  return `${env.upload.publicUrl}${attachmentRoutePath(conversationId, key)}?exp=${exp}&sig=${sig}`;
};

export const verifyAttachmentSignature = (
  conversationId: string,
  key: string,
  exp: number,
  sig: string,
  now = Date.now(),
): boolean => {
  if (!Number.isInteger(exp) || exp * 1000 <= now) return false;
  const expected = Buffer.from(signature(conversationId, key, exp));
  const given = Buffer.from(sig);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

export const parseStoredAttachments = (value: Prisma.JsonValue): StoredAttachment[] =>
  Array.isArray(value) ? (value as unknown as StoredAttachment[]) : [];

export const attachmentKeysOf = (value: Prisma.JsonValue): string[] =>
  parseStoredAttachments(value)
    .map((attachment) => ("key" in attachment ? attachment.key : null))
    .filter((key): key is string => typeof key === "string" && isAttachmentKey(key));

/** Output shape for clients: keys become signed links, legacy URLs pass through. */
export const presentAttachments = (
  conversationId: string,
  value: Prisma.JsonValue,
  now = Date.now(),
): PresentedAttachment[] =>
  parseStoredAttachments(value).map((attachment) => {
    const { name, mimeType, size } = attachment;
    if ("key" in attachment && typeof attachment.key === "string") {
      return { url: signAttachmentUrl(conversationId, attachment.key, now), name, mimeType, size };
    }
    return { url: (attachment as LegacyUrlAttachment).url, name, mimeType, size };
  });

export type OutgoingAttachment =
  | { key: string; name: string; url?: undefined }
  | { url: string; name: string; key?: undefined };

const legacyUploadPrefix = () => `${env.upload.publicUrl}/${env.upload.dir}/`;

/**
 * Turns what a client asked to attach into what gets stored. Type and size
 * always come from the file on disk, never from the request.
 */
export const resolveOutgoingAttachments = async (
  senderId: string,
  requested: OutgoingAttachment[],
): Promise<StoredAttachment[]> =>
  Promise.all(
    requested.map(async (item): Promise<StoredAttachment> => {
      const name = sanitizeOriginalName(item.name);
      if (item.key !== undefined) {
        if (!isAttachmentKey(item.key) || item.key.split("/")[0] !== senderId) {
          throw new BadRequestError("Attachments must be your own uploads");
        }
        const stat = await fs.promises.stat(attachmentPath(item.key)).catch(() => null);
        const type = typeForExtension(path.extname(item.key));
        if (!stat?.isFile() || !type) throw new BadRequestError("Attachment not found");
        return { key: item.key, name, mimeType: type.mimeType, size: stat.size };
      }

      // Older clients still attach files uploaded through the public /uploads endpoint.
      const filename = item.url.startsWith(legacyUploadPrefix())
        ? item.url.slice(legacyUploadPrefix().length)
        : "";
      const type = typeForExtension(path.extname(filename));
      if (!/^[\w.-]+$/.test(filename) || !type) {
        throw new BadRequestError("Attachments must be uploaded through this server");
      }
      const stat = await fs.promises
        .stat(path.join(publicUploadRoot, filename))
        .catch(() => null);
      if (!stat?.isFile()) throw new BadRequestError("Attachment not found");
      return { url: item.url, name, mimeType: type.mimeType, size: stat.size };
    }),
  );

/** Messages (in any conversation) that still reference `key`. */
const referencesTo = (key: string) =>
  prisma.message.count({
    where: { attachments: { array_contains: [{ key }] } },
  });

/**
 * Deletes stored files no message references any more. Call after the
 * referencing rows are gone; failures are logged, never thrown.
 */
export const removeUnreferencedAttachments = async (keys: Iterable<string>): Promise<void> => {
  for (const key of new Set(keys)) {
    try {
      if ((await referencesTo(key)) > 0) continue;
      await fs.promises.unlink(attachmentPath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
      logger.warn({ err: error, key }, "Could not remove chat attachment");
    }
  }
};

/** Keys attached anywhere in a conversation (read before deleting it). */
export const attachmentKeysInConversation = async (conversationId: string): Promise<string[]> => {
  const rows = await prisma.message.findMany({
    where: { conversationId, NOT: { attachments: { equals: [] } } },
    select: { attachments: true },
  });
  return rows.flatMap((row) => attachmentKeysOf(row.attachments));
};

/** True when a message in `conversationId` still carries `key`. */
export const conversationHasAttachment = async (
  conversationId: string,
  key: string,
): Promise<{ name: string } | null> => {
  const message = await prisma.message.findFirst({
    where: { conversationId, attachments: { array_contains: [{ key }] } },
    select: { attachments: true },
  });
  if (!message) return null;
  const match = parseStoredAttachments(message.attachments).find(
    (attachment) => "key" in attachment && attachment.key === key,
  );
  return match ? { name: match.name } : null;
};
