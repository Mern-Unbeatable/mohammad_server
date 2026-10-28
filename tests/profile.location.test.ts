import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    profile: { findUnique: vi.fn() },
    user: { update: vi.fn() },
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));

import { profileService } from "@/modules/user/profile/profile.service";
import { updateProfileSchema } from "@/modules/user/profile/profile.validators";
import { composeLocation, resolveProfileLocation } from "@/shared/utils/location";

const profileRow = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Moe",
  lastName: "Laam",
  title: "Lab Manager",
  company: "Lab Co",
  country: "Belgium",
  location: "Munich, Germany",
  phone: "+32 1",
  about: "About",
  aboutExtended: null,
  avatarUrl: null,
  coverUrl: null,
  initials: "ML",
  connectionsCount: 3,
  ...overrides,
});

const userWith = (profile: Record<string, unknown>) => ({
  id: "u1",
  email: "moe@example.com",
  role: "USER",
  profileType: "LABORATORY",
  status: "ACTIVE",
  warnings: 0,
  lastLoginAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  profile,
  subscription: null,
});

const updateData = () => prismaMock.user.update.mock.calls[0][0].data.profile.update;

describe("profile location helpers", () => {
  it("composes city and country, skipping empty parts", () => {
    expect(composeLocation(" Munich ", "Germany")).toBe("Munich, Germany");
    expect(composeLocation("", "Belgium")).toBe("Belgium");
    expect(composeLocation(null, null)).toBe("");
  });

  it("keeps the city and takes the country from the country column", () => {
    expect(resolveProfileLocation("Munich, Germany", "Belgium")).toEqual({
      city: "Munich",
      location: "Munich, Belgium",
    });
    expect(resolveProfileLocation("Lyon, France", "France")).toEqual({
      city: "Lyon",
      location: "Lyon, France",
    });
  });

  it("handles a missing city, a country-only value and a missing country", () => {
    expect(resolveProfileLocation(null, "Belgium")).toEqual({ city: "", location: "Belgium" });
    expect(resolveProfileLocation("Belgium", "Belgium")).toEqual({ city: "", location: "Belgium" });
    expect(resolveProfileLocation("Ghent", "Belgium")).toEqual({ city: "Ghent", location: "Ghent, Belgium" });
    expect(resolveProfileLocation("Munich, Germany", null)).toEqual({
      city: "Munich",
      location: "Munich, Germany",
    });
    expect(resolveProfileLocation(null, null)).toEqual({ city: "", location: null });
  });
});

describe("PATCH /users/me location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.update.mockImplementation(async ({ data }) =>
      userWith(profileRow(data.profile.update)),
    );
  });

  it("accepts city and drops a raw location from the body", () => {
    const parsed = updateProfileSchema.parse({ city: " Antwerp ", location: "Paris, France" });
    expect(parsed).toEqual({ city: "Antwerp" });
  });

  it("stores City, Country and returns them consistently", async () => {
    prismaMock.profile.findUnique.mockResolvedValue(profileRow());

    const user = await profileService.updateProfile("u1", { city: "Antwerp", country: "Belgium" });

    expect(updateData()).toMatchObject({ country: "Belgium", location: "Antwerp, Belgium" });
    expect(updateData()).not.toHaveProperty("city");
    expect(user.profile).toMatchObject({ city: "Antwerp", country: "Belgium", location: "Antwerp, Belgium" });
  });

  it("keeps the stored city when only the country changes", async () => {
    prismaMock.profile.findUnique.mockResolvedValue(profileRow());

    await profileService.updateProfile("u1", { country: "Germany" });

    expect(updateData().location).toBe("Munich, Germany");
  });

  it("clears the city when it is sent empty", async () => {
    prismaMock.profile.findUnique.mockResolvedValue(profileRow());

    await profileService.updateProfile("u1", { city: "", country: "Belgium" });

    expect(updateData().location).toBe("Belgium");
  });

  it("leaves location and other fields alone when neither city nor country is sent", async () => {
    prismaMock.profile.findUnique.mockResolvedValue(profileRow());

    await profileService.updateProfile("u1", { title: "Head of QC" });

    expect(updateData()).toEqual({ title: "Head of QC", initials: "ML" });
  });
});
