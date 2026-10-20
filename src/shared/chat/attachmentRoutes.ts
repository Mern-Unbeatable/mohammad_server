import fs from "node:fs";
import { Request, Response, Router } from "express";
import { StatusCodes } from "http-status-codes";
import { createUploader } from "@/middleware/upload";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/shared/errors/AppError";
import { setUploadSecurityHeaders } from "@/shared/files/serveHeaders";
import { sendSuccess } from "@/shared/http/apiResponse";
import { asyncHandler } from "@/shared/utils/asyncHandler";
import {
  attachmentPath,
  chatUploadFolder,
  conversationHasAttachment,
  isAttachmentKey,
  keyFor,
  verifyAttachmentSignature,
} from "./attachments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BROWSER_CACHE_SECONDS = 3600;

const chatUpload = createUploader({
  root: chatUploadFolder,
  subdir: (req) => {
    const ownerId = req.user!.id;
    if (!/^[A-Za-z0-9-]{1,64}$/.test(ownerId)) throw new BadRequestError("Invalid uploader");
    return ownerId;
  },
});

/**
 * `POST /messages/attachments` — private upload; returns a key for `sendMessage`.
 * Mounted behind the messages router's authenticate + requireActiveUser.
 */
export const chatAttachmentUploadRoutes = Router();
chatAttachmentUploadRoutes.post(
  "/",
  ...chatUpload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) throw new BadRequestError("No file provided");
    sendSuccess(res, {
      statusCode: StatusCodes.CREATED,
      data: {
        key: keyFor(req.user!.id, file.filename),
        name: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
    });
  }),
);

/**
 * `GET /chat-attachments/:conversationId/:ownerId/:file?exp&sig` — the
 * signature (issued only to conversation members and admins) is the access
 * check, and the file must still be attached to a message in that conversation.
 */
export const chatAttachmentDownloadRoutes = Router();
chatAttachmentDownloadRoutes.get(
  "/:conversationId/:ownerId/:file",
  asyncHandler(async (req: Request, res: Response) => {
    const { conversationId, ownerId, file } = req.params;
    const key = `${ownerId}/${file}`;
    const exp = Number(req.query.exp);
    const sig = typeof req.query.sig === "string" ? req.query.sig : "";
    const now = Date.now();

    if (
      !UUID.test(conversationId) ||
      !isAttachmentKey(key) ||
      !verifyAttachmentSignature(conversationId, key, exp, sig, now)
    ) {
      throw new ForbiddenError("This attachment link is invalid or has expired");
    }

    const reference = await conversationHasAttachment(conversationId, key);
    const filePath = attachmentPath(key);
    const stat = reference ? await fs.promises.stat(filePath).catch(() => null) : null;
    if (!reference || !stat?.isFile()) throw new NotFoundError("Attachment not found");

    setUploadSecurityHeaders(res, filePath, reference.name);
    res.setHeader("Referrer-Policy", "no-referrer");
    const remaining = Math.floor(exp - now / 1000);
    res.setHeader(
      "Cache-Control",
      `private, max-age=${Math.max(0, Math.min(MAX_BROWSER_CACHE_SECONDS, remaining))}`,
    );
    await new Promise<void>((resolve, reject) =>
      res.sendFile(filePath, { cacheControl: false, dotfiles: "deny" }, (error) =>
        // Once streaming has started the response can only be aborted, not replaced.
        error && !res.headersSent ? reject(error) : resolve(),
      ),
    );
  }),
);
