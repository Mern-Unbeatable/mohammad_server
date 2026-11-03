import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Role, UserStatus } from "@prisma/client";
import { connectTestSocket, settle, type TestSocket } from "./helpers/socketClient";

const { prismaMock, statuses } = vi.hoisted(() => {
  const statuses = new Map<string, string>();
  return {
    statuses,
    prismaMock: {
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          statuses.has(where.id)
            ? { id: where.id, role: "USER", status: statuses.get(where.id) }
            : null,
        ),
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in
            .filter((id) => statuses.has(id))
            .map((id) => ({ id, status: statuses.get(id) })),
        ),
      },
      conversationParticipant: { findMany: vi.fn(async () => []) },
    },
  };
});

vi.mock("@/infrastructure/prisma", () => ({
  prisma: prismaMock,
  onNotificationsCreated: vi.fn(),
}));

import {
  closeRealtime,
  disconnectUser,
  emitToUsers,
  initRealtime,
  revalidateSessions,
} from "@/realtime/socket";
import { signAccessToken } from "@/shared/utils/jwt";

let server: http.Server;
let port: number;
const open: TestSocket[] = [];

const tokenFor = (id: string) =>
  signAccessToken({ sub: id, role: Role.USER, email: `${id}@test.example` });

const connect = async (id: string) => {
  const socket = connectTestSocket(port, tokenFor(id));
  open.push(socket);
  await socket.connected;
  return socket;
};

beforeAll(async () => {
  server = http.createServer();
  initRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  open.forEach((socket) => socket.close());
  await closeRealtime();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  statuses.clear();
  open.splice(0).forEach((socket) => socket.close());
});

describe("socket handshake", () => {
  it("rejects suspended and banned accounts", async () => {
    statuses.set("sus", UserStatus.SUSPENDED);
    statuses.set("ban", UserStatus.BANNED);
    await expect(connectTestSocket(port, tokenFor("sus")).connected).rejects.toThrow("FORBIDDEN");
    await expect(connectTestSocket(port, tokenFor("ban")).connected).rejects.toThrow("FORBIDDEN");
  });

  it("rejects missing tokens", async () => {
    await expect(connectTestSocket(port).connected).rejects.toThrow("UNAUTHENTICATED");
  });
});

describe("disconnectUser", () => {
  it("ends the user's sockets so they stop receiving chat events", async () => {
    statuses.set("u1", UserStatus.ACTIVE);
    statuses.set("u2", UserStatus.ACTIVE);
    const target = await connect("u1");
    const bystander = await connect("u2");

    emitToUsers(["u1", "u2"], "message:new", { n: 1 });
    await target.waitFor("message:new");
    await bystander.waitFor("message:new");

    disconnectUser("u1");
    await target.waitFor("session:revoked");
    await target.serverDisconnected;

    emitToUsers(["u1", "u2"], "message:new", { n: 2 });
    await bystander.waitFor("message:new", 2);
    await settle();
    expect(target.events.filter(([event]) => event === "message:new")).toEqual([
      ["message:new", { n: 1 }],
    ]);
  });
});

describe("revalidateSessions", () => {
  it("drops sockets of accounts suspended after the handshake and keeps active ones", async () => {
    statuses.set("u1", UserStatus.ACTIVE);
    statuses.set("u2", UserStatus.ACTIVE);
    const suspended = await connect("u1");
    const active = await connect("u2");

    statuses.set("u1", UserStatus.SUSPENDED);
    await revalidateSessions();

    await suspended.waitFor("session:revoked");
    await suspended.serverDisconnected;
    emitToUsers(["u1", "u2"], "message:new", { n: 1 });
    await active.waitFor("message:new");
    await settle();
    expect(suspended.events.some(([event]) => event === "message:new")).toBe(false);
    expect(active.events.some(([event]) => event.startsWith("session:"))).toBe(false);
  });

  it("asks sockets with an expired access token to re-authenticate", async () => {
    statuses.set("u1", UserStatus.ACTIVE);
    const socket = await connect("u1");

    await revalidateSessions(Date.now() + 24 * 60 * 60 * 1000);

    await socket.waitFor("session:expired");
    await socket.serverDisconnected;
  });

  it("leaves sockets with a valid token alone", async () => {
    statuses.set("u1", UserStatus.ACTIVE);
    const socket = await connect("u1");

    await revalidateSessions();
    emitToUsers(["u1"], "message:new", { n: 1 });

    await socket.waitFor("message:new");
    expect(socket.events.some(([event]) => event.startsWith("session:"))).toBe(false);
  });
});
