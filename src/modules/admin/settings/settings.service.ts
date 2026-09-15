import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { NotFoundError } from "@/shared/errors/AppError";

export const settingsService = {
  async getSettings() {
    const settings = await prisma.appSetting.findMany();
    return settings.reduce<Record<string, Prisma.JsonValue>>((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});
  },

  async getSetting(key: string) {
    const setting = await prisma.appSetting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundError("Setting not found");
    return setting.value;
  },

  async upsertSetting(key: string, value: Prisma.InputJsonValue) {
    const setting = await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return { key: setting.key, value: setting.value };
  },
};
