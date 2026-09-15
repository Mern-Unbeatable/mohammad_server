import { z } from "zod";
import { paginationQuerySchema } from "@/shared/http/pagination";

export const notificationListQuerySchema = paginationQuerySchema.extend({
  unread: z.coerce.boolean().optional(),
});

export const notificationIdParamSchema = z.object({ id: z.string().uuid() });
