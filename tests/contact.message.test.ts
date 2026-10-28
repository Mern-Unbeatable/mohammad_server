import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/mailer", () => ({ sendMail: vi.fn() }));

import { contactMessageSchema } from "@/modules/contact/contact.validators";
import { buildContactEmail } from "@/modules/contact/contact.service";
import { env } from "@/config/env";

const valid = {
  fullName: "Jane Doe",
  email: "Jane@Example.com",
  phone: "+32 123 456",
  company: "Acme Labs",
  inquiryType: "membership",
  message: "I would like to know more about membership.",
};

describe("contactMessageSchema", () => {
  it("accepts a complete message and normalises the email", () => {
    const parsed = contactMessageSchema.parse(valid);
    expect(parsed.email).toBe("jane@example.com");
  });

  it("allows phone and company to be omitted", () => {
    const { phone: _phone, company: _company, ...rest } = valid;
    expect(contactMessageSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects line breaks in fields that end up in mail headers", () => {
    const result = contactMessageSchema.safeParse({
      ...valid,
      fullName: "Jane\r\nBcc: victim@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown inquiry type and a too-short message", () => {
    expect(contactMessageSchema.safeParse({ ...valid, inquiryType: "sales" }).success).toBe(false);
    expect(contactMessageSchema.safeParse({ ...valid, message: "Hi" }).success).toBe(false);
  });
});

describe("buildContactEmail", () => {
  it("sends to the contact inbox with the sender as reply-to", () => {
    const mail = buildContactEmail(contactMessageSchema.parse(valid));
    expect(mail.to).toBe(env.contactInbox);
    expect(mail.replyTo).toBe("jane@example.com");
    expect(mail.subject).toBe("[Contact] Membership inquiry from Jane Doe");
    expect(mail.text).toContain("Company: Acme Labs");
    expect(mail.text).toContain("I would like to know more about membership.");
  });
});
