import path from "node:path";
import type { Response } from "express";
import { INLINE_EXTENSIONS } from "./fileType";

/** Applied to every user-uploaded file the server returns. */
export const UPLOAD_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; sandbox";

const quoteFilename = (name: string) => name.replace(/["\\\r\n]/g, "_");

/**
 * Stops browsers from sniffing or executing uploaded content: raster images
 * may display inline, anything else is a download.
 */
export const setUploadSecurityHeaders = (
  res: Response,
  filePath: string,
  downloadName?: string,
): void => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", UPLOAD_CSP);
  const ext = path.extname(filePath).toLowerCase();
  const name = downloadName ?? path.basename(filePath);
  const disposition = INLINE_EXTENSIONS.has(ext) ? "inline" : "attachment";
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${quoteFilename(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  );
};
