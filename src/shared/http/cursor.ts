import { z } from "zod";

/**
 * Keyset pagination over `(timestamp, id)`: rows sharing a timestamp are
 * ordered by id, so pages never skip or repeat them, and new activity does
 * not shift later pages the way offsets do.
 */
export interface KeysetCursor {
  at: Date;
  id: string;
}

export const encodeCursor = ({ at, id }: KeysetCursor): string =>
  Buffer.from(JSON.stringify([at.toISOString(), id])).toString("base64url");

export const decodeCursor = (value: string): KeysetCursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [iso, id] = parsed;
    const at = new Date(iso);
    if (typeof iso !== "string" || Number.isNaN(at.getTime())) return null;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
};

/** Opaque `cursor` query parameter, decoded during validation. */
export const cursorParam = z
  .string()
  .max(200)
  .transform((value, ctx) => {
    const cursor = decodeCursor(value);
    if (!cursor) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid cursor" });
      return z.NEVER;
    }
    return cursor;
  });

/** Rows strictly older than the cursor in `(field desc, id desc)` order. */
export const olderThan = <F extends string>(field: F, cursor: KeysetCursor) => ({
  OR: [
    { [field]: { lt: cursor.at } } as Record<F, { lt: Date }>,
    { [field]: cursor.at, id: { lt: cursor.id } } as Record<F, Date> & { id: { lt: string } },
  ],
});
