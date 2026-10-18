import { describe, expect, it } from "vitest";
import {
  createListingSchema,
  listingListQuerySchema,
  updateListingSchema,
} from "@/modules/user/marketplace/marketplace.validators";

const validListing = {
  title: "Glassware lot",
  description: "Assorted beakers and flasks",
  condition: "GOOD",
  category: "OTHER",
  price: 120,
};

describe("marketplace category validation", () => {
  it("accepts OTHER when creating a listing", () => {
    expect(createListingSchema.parse(validListing).category).toBe("OTHER");
  });

  it("accepts OTHER when updating a listing", () => {
    expect(updateListingSchema.parse({ category: "OTHER" }).category).toBe("OTHER");
  });

  it("accepts OTHER as a list filter", () => {
    expect(listingListQuerySchema.parse({ category: "OTHER" }).category).toBe("OTHER");
  });

  it("still rejects categories outside the enum", () => {
    expect(createListingSchema.safeParse({ ...validListing, category: "Other" }).success).toBe(
      false,
    );
    expect(createListingSchema.safeParse({ ...validListing, category: "MISC" }).success).toBe(
      false,
    );
  });
});
