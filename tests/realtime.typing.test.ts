import type { AddressInfo } from "node:net";
import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        role: "USER",
        status: "ACTIVE",
      })),
      findMany: vi.fn(async () => []),
    },
    conversationParticipant: { findMany: vi.fn() },
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock, onNotificationsCreated: vi.fn() }));

import { closeRealtime, initRealtime } from "@/realtime/socket";
import {
  TYPING_BURST,
  TYPING_BURST_WINDOW_MS,
  TYPING_REPEAT_MS,
  createTypingThrottle,
} from "@/realtime/typingThrottle";
import { signAccessToken } from "@/shared/utils/jwt";
import { connectTestSocket, settle } from "./helpers/socketClient";

describe("createTypingThrottle", () => {
  it("drops repeats of the same state inside the repeat window", () => {
    const allow = createTypingThrottle();
    expect(allow("c1", true, 0)).toBe(true);
    expect(allow("c1", true, TYPING_REPEAT_MS - 1)).toBe(false);
    expect(allow("c1", true, TYPING_REPEAT_MS)).toBe(true);
  });

  it("lets a stop through immediately and tracks conversations separately", () => {
    const allow = createTypingThrottle();
    expect(allow("c1", true, 0)).toBe(true);
    expect(allow("c1", false, 10)).toBe(true);
    expect(allow("c2", true, 20)).toBe(true);
  });

  it("caps toggling floods per window", () => {
    const allow = createTypingThrottle();
    const results = Array.from({ length: TYPING_BURST + 5 }, (_, i) => allow("c1", i % 2 === 0, i));
    expect(results.filter(Boolean)).toHaveLength(TYPING_BURST);
    expect(allow("c1", true, TYPING_BURST_WINDOW_MS + 1)).toBe(true);
  });
});

describe("typing relay over Socket.IO", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer();
    initRealtime(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await closeRealtime();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    prismaMock.conversationParticipant.findMany.mockResolvedValue([{ userId: "u1" }, { userId: "u2" }]);
  });

  const token = (id: string) => signAccessToken({ sub: id, role: Role.USER, email: `${id}@x.test` });

  it("relays one typing event per window and skips the DB lookup for dropped ones", async () => {
    const typist = await connectTestSocket(port, token("u1"));
    const reader = await connectTestSocket(port, token("u2"));
    await Promise.all([typist.connected, reader.connected]);
    prismaMock.conversationParticipant.findMany.mockClear();

    for (let i = 0; i < 5; i += 1) typist.emit("typing", { conversationId: "c1", typing: true });
    await reader.waitFor("typing");
    typist.emit("typing", { conversationId: "c1", typing: false });
    await reader.waitFor("typing", 2);
    await settle(150);

    const typingEvents = reader.events.filter(([name]) => name === "typing").map(([, payload]) => payload);
    expect(typingEvents).toEqual([
      { conversationId: "c1", userId: "u1", typing: true },
      { conversationId: "c1", userId: "u1", typing: false },
    ]);
    expect(prismaMock.conversationParticipant.findMany).toHaveBeenCalledTimes(2);

    typist.close();
    reader.close();
  });
});
