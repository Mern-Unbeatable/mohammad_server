import { describe, expect, it } from "vitest";
import { createAdSchema } from "@/modules/supplier/advertisements/advertisements.validators";

const baseInput = {
  title: "Sponsored Product",
  category: "PRODUCT",
  description: "A detailed ad",
  destinationMode: "INTERNAL",
  destinationResourceId: "11111111-1111-1111-1111-111111111111",
  durationDays: 7,
};

describe("createAdSchema destination validation", () => {
  it("requires destinationMode", () => {
    const { success } = createAdSchema.safeParse({
      ...baseInput,
      destinationMode: undefined,
    });
    expect(success).toBe(false);
  });

  it("accepts valid external http url", () => {
    const parsed = createAdSchema.parse({
      ...baseInput,
      destinationMode: "EXTERNAL",
      destinationResourceId: undefined,
      destinationUrl: "https://example.com/path",
    });
    expect(parsed.destinationUrl).toBe("https://example.com/path");
  });

  it("rejects non-http external url", () => {
    const { success } = createAdSchema.safeParse({
      ...baseInput,
      destinationMode: "EXTERNAL",
      destinationUrl: "ftp://example.com/path",
    });
    expect(success).toBe(false);
  });
});
