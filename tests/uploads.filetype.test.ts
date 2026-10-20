import { describe, expect, it } from "vitest";
import {
  detectFileType,
  judgeUpload,
  sanitizeOriginalName,
} from "@/shared/files/fileType";
import { fixtures } from "./helpers/fileFixtures";

describe("detectFileType", () => {
  it.each([
    ["jpeg", fixtures.jpeg(), "", ".jpg", "image/jpeg"],
    ["png", fixtures.png(), "", ".png", "image/png"],
    ["gif", fixtures.gif(), "", ".gif", "image/gif"],
    ["webp", fixtures.webp(), "", ".webp", "image/webp"],
    ["pdf", fixtures.pdf(), "", ".pdf", "application/pdf"],
    ["legacy Word", fixtures.ole(), ".doc", ".doc", "application/msword"],
    ["legacy Excel", fixtures.ole(), ".XLS", ".xls", "application/vnd.ms-excel"],
    ["legacy PowerPoint", fixtures.ole(), ".ppt", ".ppt", "application/vnd.ms-powerpoint"],
    [
      "docx",
      fixtures.ooxml("word"),
      "",
      ".docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "xlsx",
      fixtures.ooxml("xl"),
      "",
      ".xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    [
      "pptx",
      fixtures.ooxml("ppt"),
      "",
      ".pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    ["mp4", fixtures.mp4(), "", ".mp4", "video/mp4"],
    ["mov", fixtures.mov(), "", ".mov", "video/quicktime"],
  ])("recognises %s from its bytes", (_label, bytes, declaredExt, ext, mimeType) => {
    expect(detectFileType(bytes, Buffer.alloc(0), declaredExt)).toMatchObject({ ext, mimeType });
  });

  it("finds Office part names in the zip's central directory (end of file)", () => {
    const head = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
    const tail = Buffer.from("[Content_Types].xml word/document.xml", "latin1");
    expect(detectFileType(head, tail)?.ext).toBe(".docx");
  });

  it.each([
    ["HTML", fixtures.html(), ""],
    ["SVG", fixtures.svg(), ""],
    ["Windows executable", fixtures.exe(), ""],
    ["plain zip", fixtures.zip(), ""],
    ["macro-enabled Office file", fixtures.ooxml("word", " word/vbaProject.bin"), ""],
    ["OLE container without an Office extension", fixtures.ole(), ".msg"],
    ["HEIC image in an ISO media box", fixtures.heic(), ""],
    ["empty file", Buffer.alloc(0), ""],
  ])("rejects %s", (_label, bytes, declaredExt) => {
    expect(detectFileType(bytes, Buffer.alloc(0), declaredExt)).toBeNull();
  });
});

describe("judgeUpload", () => {
  const detect = (bytes: Buffer, name: string) =>
    detectFileType(bytes, Buffer.alloc(0), name.slice(name.lastIndexOf(".")));

  it("derives the stored type from content, not the client's name or MIME type", () => {
    const verdict = judgeUpload(detect(fixtures.jpeg(), "photo.png"), "photo.png", "image/png");
    expect(verdict).toEqual({
      ok: true,
      type: expect.objectContaining({ ext: ".jpg", mimeType: "image/jpeg" }),
    });
  });

  it("accepts a file with no extension and a generic MIME type", () => {
    const verdict = judgeUpload(detect(fixtures.pdf(), "scan"), "scan", "application/octet-stream");
    expect(verdict).toMatchObject({ ok: true, type: { ext: ".pdf" } });
  });

  it.each([
    ["image named as a PDF", fixtures.png(), "report.pdf", "application/pdf"],
    ["PDF declared as an image", fixtures.pdf(), "scan.pdf", "image/jpeg"],
    ["video named as a document", fixtures.mp4(), "notes.docx", "video/mp4"],
  ])("rejects a %s", (_label, bytes, name, mime) => {
    expect(judgeUpload(detect(bytes, name), name, mime)).toEqual({
      ok: false,
      reason: "File content does not match its name or type",
    });
  });

  it.each([
    ["GIF/script polyglot named .html", fixtures.gifPolyglot(), "x.html", "image/gif"],
    ["PNG named .svg", fixtures.png(), "logo.svg", "image/png"],
    ["PNG declared as SVG", fixtures.png(), "logo.png", "image/svg+xml"],
    ["PNG declared as HTML", fixtures.png(), "logo.png", "text/html"],
    ["macro-enabled Word name", fixtures.ooxml("word"), "invoice.docm", "application/octet-stream"],
  ])("rejects dangerous names or types: %s", (_label, bytes, name, mime) => {
    expect(judgeUpload(detect(bytes, name), name, mime)).toEqual({
      ok: false,
      reason: "This file type is not allowed",
    });
  });

  it("rejects unrecognised content even when the name looks safe", () => {
    expect(judgeUpload(detect(fixtures.html(), "cat.jpg"), "cat.jpg", "image/jpeg")).toEqual({
      ok: false,
      reason: "Unsupported or unrecognised file content",
    });
  });

  it("rejects unsupported extensions on otherwise valid content", () => {
    expect(judgeUpload(detect(fixtures.png(), "cat.bmp"), "cat.bmp", "")).toEqual({
      ok: false,
      reason: "Unsupported file extension: .bmp",
    });
  });

  it("keeps Office documents whose MIME type contains 'xml'", () => {
    const name = "plan.xlsx";
    const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(judgeUpload(detect(fixtures.ooxml("xl"), name), name, mime)).toMatchObject({ ok: true });
  });
});

describe("sanitizeOriginalName", () => {
  it("drops path segments, quotes and control characters", () => {
    expect(sanitizeOriginalName('..\\..\\etc/pass"wd\u0000.pdf')).toBe("passwd.pdf");
    expect(sanitizeOriginalName("")).toBe("file");
    expect(sanitizeOriginalName(`${"a".repeat(300)}.pdf`)).toHaveLength(255);
  });
});
