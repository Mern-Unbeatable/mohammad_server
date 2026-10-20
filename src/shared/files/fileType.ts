import fs from "node:fs/promises";
import path from "node:path";

export type FileKind = "image" | "document" | "video";

export interface DetectedType {
  ext: string;
  mimeType: string;
  kind: FileKind;
}

const TYPES = {
  jpg: { ext: ".jpg", mimeType: "image/jpeg", kind: "image" },
  png: { ext: ".png", mimeType: "image/png", kind: "image" },
  gif: { ext: ".gif", mimeType: "image/gif", kind: "image" },
  webp: { ext: ".webp", mimeType: "image/webp", kind: "image" },
  pdf: { ext: ".pdf", mimeType: "application/pdf", kind: "document" },
  doc: { ext: ".doc", mimeType: "application/msword", kind: "document" },
  xls: { ext: ".xls", mimeType: "application/vnd.ms-excel", kind: "document" },
  ppt: { ext: ".ppt", mimeType: "application/vnd.ms-powerpoint", kind: "document" },
  docx: {
    ext: ".docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
  },
  xlsx: {
    ext: ".xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "document",
  },
  pptx: {
    ext: ".pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "document",
  },
  mp4: { ext: ".mp4", mimeType: "video/mp4", kind: "video" },
  mov: { ext: ".mov", mimeType: "video/quicktime", kind: "video" },
} as const satisfies Record<string, DetectedType>;

/** Every MIME type the server accepts, keyed by canonical extension. */
export const SUPPORTED_TYPES: readonly DetectedType[] = Object.values(TYPES);

const byExt = new Map<string, DetectedType>(
  SUPPORTED_TYPES.map((type) => [type.ext, type]),
);
byExt.set(".jpeg", TYPES.jpg);
byExt.set(".jpe", TYPES.jpg);

const byMime = new Map<string, DetectedType>(
  SUPPORTED_TYPES.map((type) => [type.mimeType, type]),
);
byMime.set("image/jpg", TYPES.jpg);
byMime.set("image/pjpeg", TYPES.jpg);

/** Types a browser could execute or render as active content; never accepted. */
const DANGEROUS_EXTENSIONS = new Set([
  ".html", ".htm", ".xhtml", ".shtml", ".svg", ".svgz", ".xml", ".xsl", ".js", ".mjs",
  ".cjs", ".css", ".swf", ".exe", ".dll", ".com", ".bat", ".cmd", ".msi", ".sh", ".ps1",
  ".vbs", ".jar", ".php", ".asp", ".aspx", ".jsp", ".hta", ".scr", ".docm", ".xlsm",
  ".pptm", ".dotm", ".xltm", ".potm",
]);
const DANGEROUS_MIME =
  /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/(x-)?javascript|application\/ecmascript|application\/x-sh|application\/x-msdownload)|macroenabled/i;

/** ISO base-media brands we treat as playable video (excludes HEIF/AVIF images, audio). */
const VIDEO_BRANDS = new Set([
  "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VH",
  "M4VP", "mmp4", "dash", "MSNV", "f4v ", "3gp4", "3gp5", "3gp6",
]);

const HEAD_BYTES = 64 * 1024;

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (buf: Buffer, start: number, end: number) =>
  buf.length >= end ? buf.toString("latin1", start, end) : "";

/** OOXML packages are zips; the part names say which application they belong to. */
const detectOoxml = (zipText: string): DetectedType | null => {
  if (zipText.includes("vbaProject.bin")) return null;
  if (!zipText.includes("[Content_Types].xml")) return null;
  if (zipText.includes("word/")) return TYPES.docx;
  if (zipText.includes("xl/")) return TYPES.xlsx;
  if (zipText.includes("ppt/")) return TYPES.pptx;
  return null;
};

/**
 * Identifies a file from its leading bytes (and, for zip-based Office files,
 * its entry names). `declaredExt` only chooses between legacy Office formats,
 * which share one container signature.
 */
export const detectFileType = (
  head: Buffer,
  tail: Buffer = Buffer.alloc(0),
  declaredExt = "",
): DetectedType | null => {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return TYPES.jpg;
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return TYPES.png;
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return TYPES.gif;
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return TYPES.webp;
  if (ascii(head, 0, 5) === "%PDF-") return TYPES.pdf;

  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const ext = declaredExt.toLowerCase();
    if (ext === ".doc") return TYPES.doc;
    if (ext === ".xls") return TYPES.xls;
    if (ext === ".ppt") return TYPES.ppt;
    return null;
  }

  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    return detectOoxml(head.toString("latin1") + tail.toString("latin1"));
  }

  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand === "qt  ") return TYPES.mov;
    if (VIDEO_BRANDS.has(brand)) return TYPES.mp4;
  }

  return null;
};

/** Reads the start and end of a file on disk and detects its type. */
export const detectFileTypeFromPath = async (
  filePath: string,
  declaredExt = "",
): Promise<DetectedType | null> => {
  const handle = await fs.open(filePath, "r");
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(Math.min(HEAD_BYTES, size));
    await handle.read(head, 0, head.length, 0);
    const tailLength = Math.min(HEAD_BYTES, Math.max(0, size - head.length));
    const tail = Buffer.alloc(tailLength);
    if (tailLength > 0) await handle.read(tail, 0, tailLength, size - tailLength);
    return detectFileType(head, tail, declaredExt);
  } finally {
    await handle.close();
  }
};

export const typeForExtension = (ext: string): DetectedType | undefined =>
  byExt.get(ext.toLowerCase());

export type UploadVerdict =
  | { ok: true; type: DetectedType }
  | { ok: false; reason: string };

/**
 * Accepts a file only when its content is a supported type and neither the
 * client's file name nor its declared MIME type claims something else.
 */
export const judgeUpload = (
  detected: DetectedType | null,
  originalName: string,
  declaredMime: string,
): UploadVerdict => {
  const ext = path.extname(originalName).toLowerCase();
  if (DANGEROUS_EXTENSIONS.has(ext) || DANGEROUS_MIME.test(declaredMime)) {
    return { ok: false, reason: "This file type is not allowed" };
  }
  if (!detected) {
    return { ok: false, reason: "Unsupported or unrecognised file content" };
  }
  const claimedByExt = ext ? byExt.get(ext) : undefined;
  if (ext && !claimedByExt) {
    return { ok: false, reason: `Unsupported file extension: ${ext}` };
  }
  const claimedByMime = byMime.get(declaredMime.toLowerCase());
  const mismatched = [claimedByExt, claimedByMime].some(
    (claimed) => claimed && claimed.kind !== detected.kind,
  );
  if (mismatched) {
    return { ok: false, reason: "File content does not match its name or type" };
  }
  return { ok: true, type: detected };
};

/** Keeps a display name safe to echo back: no path parts or control characters. */
export const sanitizeOriginalName = (name: string): string => {
  const base = path.basename(name.replace(/\\/g, "/"));
  const cleaned = Array.from(base)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f && !'"<>'.includes(char);
    })
    .join("")
    .trim();
  return (cleaned || "file").slice(0, 255);
};

/** Inline rendering is limited to raster images; everything else downloads. */
export const INLINE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
