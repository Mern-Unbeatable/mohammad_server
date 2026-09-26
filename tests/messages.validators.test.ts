import { describe, expect, it } from "vitest";
import {
  conversationListQuerySchema,
  messageListQuerySchema,
  sendMessageSchema,
  startDirectSchema,
} from "@/modules/user/messages/messages.validators";

const upload = {
  url: "http://localhost:4000/uploads/report.pdf",
  name: "report.pdf",
  mimeType: "application/pdf",
  size: 1024,
};

describe("sendMessageSchema", () => {
  it("accepts text only", () => {
    expect(sendMessageSchema.parse({ body: " hi " })).toEqual({
      body: "hi",
      attachments: [],
    });
  });

  it("accepts attachments without text", () => {
    const parsed = sendMessageSchema.parse({ attachments: [upload] });
    expect(parsed.body).toBe("");
    expect(parsed.attachments).toHaveLength(1);
  });

  it("rejects an empty message", () => {
    expect(() => sendMessageSchema.parse({ body: "   " })).toThrow();
  });

  it("rejects attachments hosted elsewhere", () => {
    expect(() =>
      sendMessageSchema.parse({
        attachments: [{ ...upload, url: "https://evil.example.com/x.pdf" }],
      }),
    ).toThrow();
  });
});

describe("startDirectSchema", () => {
  it("requires a UUID recipient", () => {
    expect(() =>
      startDirectSchema.parse({ participantId: "marcus-weber", message: "hi" }),
    ).toThrow();
    expect(
      startDirectSchema.parse({
        participantId: "4f1c2b8e-3a4d-4e5f-9a6b-7c8d9e0f1a2b",
        message: "hi",
      }).participantId,
    ).toBe("4f1c2b8e-3a4d-4e5f-9a6b-7c8d9e0f1a2b");
  });
});

describe("list query schemas", () => {
  it("applies conversation list defaults", () => {
    expect(conversationListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 30,
    });
  });

  it("parses the thread cursor as a date", () => {
    const parsed = messageListQuerySchema.parse({
      before: "2026-09-26T04:00:00.000Z",
    });
    expect(parsed.before).toBeInstanceOf(Date);
    expect(parsed.pageSize).toBe(30);
  });
});
