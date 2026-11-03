import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { fixtures } from "./helpers/fileFixtures";

// Upload roots resolve from the working directory; keep test files out of the repo.
const { workDir, originalCwd } = vi.hoisted(() => {
  const fsSync = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const pathMod = require("node:path") as typeof import("node:path");
  const originalCwd = process.cwd();
  const workDir = fsSync.mkdtempSync(pathMod.join(os.tmpdir(), "lu-uploads-"));
  process.chdir(workDir);
  process.env.MAX_UPLOAD_SIZE_MB = "1";
  process.env.MAX_UPLOAD_FILES = "3";
  return { workDir, originalCwd };
});

vi.mock("@/infrastructure/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) } },
  onNotificationsCreated: vi.fn(),
}));

import { startTestApp, tokenFor } from "./helpers/httpApp";

const uploadsDir = path.join(workDir, "uploads");
const stagingDir = path.join(uploadsDir, ".incoming");
const token = tokenFor("u1", Role.USER);

let app: Awaited<ReturnType<typeof startTestApp>>;
let origin: string;

beforeAll(async () => {
  app = await startTestApp();
  origin = (await app.request("GET", "/__probe__")).url.replace(/\/api\/v1.*$/, "");
});
afterAll(async () => {
  await app.close();
  process.chdir(originalCwd);
});

const form = (...files: Array<[Buffer, string, string]>) => {
  const body = new FormData();
  const field = files.length > 1 ? "files" : "file";
  files.forEach(([bytes, name, type]) => body.append(field, new Blob([bytes], { type }), name));
  return body;
};

const stagedFiles = () => (fs.existsSync(stagingDir) ? fs.readdirSync(stagingDir) : []);
const storedFiles = () => fs.readdirSync(uploadsDir).filter((name) => name !== ".incoming");

describe("POST /uploads", () => {
  it("stores a file under the type detected from its bytes", async () => {
    const response = await app.request("POST", "/uploads", {
      token,
      body: form([fixtures.jpeg(), "holiday.png", "image/png"]),
    });
    const { data } = await response.json();

    expect(response.status).toBe(201);
    expect(data.mimeType).toBe("image/jpeg");
    expect(data.filename).toMatch(/^\d+-[0-9a-f]{16}\.jpg$/);
    expect(data.originalName).toBe("holiday.png");
    expect(data.url).toBe(`http://localhost:4000/uploads/${data.filename}`);
    expect(fs.existsSync(path.join(uploadsDir, data.filename))).toBe(true);
    expect(stagedFiles()).toEqual([]);
  });

  it.each([
    ["HTML disguised as an image", fixtures.html(), "cat.jpg", "image/jpeg", 400],
    ["SVG", fixtures.svg(), "logo.svg", "image/svg+xml", 400],
    ["GIF/script polyglot named .html", fixtures.gifPolyglot(), "x.html", "image/gif", 400],
    ["image named as a PDF", fixtures.png(), "invoice.pdf", "application/pdf", 400],
    ["executable", fixtures.exe(), "setup.exe", "application/octet-stream", 400],
  ])("rejects %s and keeps nothing on disk", async (_label, bytes, name, type, status) => {
    const before = storedFiles();
    const response = await app.request("POST", "/uploads", {
      token,
      body: form([bytes, name, type]),
    });

    expect(response.status).toBe(status);
    expect(storedFiles()).toEqual(before);
    expect(stagedFiles()).toEqual([]);
  });

  it("rejects the whole batch when any file is bad", async () => {
    const before = storedFiles();
    const response = await app.request("POST", "/uploads/multiple", {
      token,
      body: form(
        [fixtures.png(), "a.png", "image/png"],
        [fixtures.html(), "b.png", "image/png"],
      ),
    });
    const { error } = await response.json();

    expect(response.status).toBe(400);
    expect(error.details).toEqual({ file: "b.png" });
    expect(storedFiles()).toEqual(before);
    expect(stagedFiles()).toEqual([]);
  });

  it("enforces the file count limit", async () => {
    const png: [Buffer, string, string] = [fixtures.png(), "a.png", "image/png"];
    const response = await app.request("POST", "/uploads/multiple", {
      token,
      body: form(png, png, png, png),
    });
    expect(response.status).toBe(400);
    expect(stagedFiles()).toEqual([]);
  });

  it("enforces the size limit with 413", async () => {
    const big = Buffer.concat([fixtures.pdf(), Buffer.alloc(1024 * 1024 + 1)]);
    const response = await app.request("POST", "/uploads", {
      token,
      body: form([big, "big.pdf", "application/pdf"]),
    });
    const { error } = await response.json();

    expect(response.status).toBe(413);
    expect(error.code).toBe("FILE_TOO_LARGE");
    expect(stagedFiles()).toEqual([]);
  });
});

describe("GET /uploads/:file", () => {
  const upload = async (bytes: Buffer, name: string, type: string) => {
    const response = await app.request("POST", "/uploads", { token, body: form([bytes, name, type]) });
    return (await response.json()).data.filename as string;
  };

  it("serves images inline with nosniff and a sandboxing CSP", async () => {
    const filename = await upload(fixtures.png(), "a.png", "image/png");
    const response = await fetch(`${origin}/uploads/${filename}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("serves documents as downloads", async () => {
    const filename = await upload(fixtures.pdf(), "a.pdf", "application/pdf");
    const response = await fetch(`${origin}/uploads/${filename}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("keeps legacy URLs working but never renders legacy active content", async () => {
    fs.writeFileSync(path.join(uploadsDir, "legacy-page.html"), fixtures.html());
    fs.writeFileSync(path.join(uploadsDir, "legacy-photo.jpg"), fixtures.jpeg());

    const page = await fetch(`${origin}/uploads/legacy-page.html`);
    const photo = await fetch(`${origin}/uploads/legacy-photo.jpg`);

    expect(page.status).toBe(200);
    expect(page.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(page.headers.get("content-security-policy")).toContain("sandbox");
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("does not expose the staging folder", async () => {
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, "pending"), fixtures.png());
    const response = await fetch(`${origin}/uploads/.incoming/pending`);
    fs.unlinkSync(path.join(stagingDir, "pending"));

    expect(response.status).toBe(404);
  });
});
