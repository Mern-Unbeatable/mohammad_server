import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Role } from "@prisma/client";
import { createApp } from "@/app";
import { signAccessToken } from "@/shared/utils/jwt";

/** Runs the real Express app on an ephemeral port for route-level tests. */
export const startTestApp = async () => {
  const server: Server = await new Promise((resolve) => {
    const instance = createApp().listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const request = (
    method: string,
    path: string,
    { token, body }: { token?: string; body?: BodyInit | object } = {},
  ) => {
    const isForm = body instanceof FormData;
    return fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  };

  return {
    request,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

export const tokenFor = (id: string, role: Role) =>
  signAccessToken({ sub: id, role, email: `${id}@test.example` });
