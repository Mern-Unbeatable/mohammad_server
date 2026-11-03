/** Minimal byte sequences that carry each format's real signature. */
const pad = (head: number[] | Buffer, size = 64) =>
  Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, size - head.length))]);

export const fixtures = {
  jpeg: () => pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  png: () => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
  gif: () => pad(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1")),
  webp: () => pad(Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ", "latin1")),
  pdf: () => pad(Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")),
  ole: () => pad([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  ooxml: (part: "word" | "xl" | "ppt", extra = "") =>
    pad(
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from(`....[Content_Types].xml....${part}/document.xml${extra}`, "latin1"),
      ]),
      256,
    ),
  /** A zip that is not an Office document. */
  zip: () => pad(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("readme.txt")])),
  mp4: () => pad(Buffer.from("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00", "latin1")),
  mov: () => pad(Buffer.from("\x00\x00\x00\x14ftypqt  \x00\x00\x02\x00", "latin1")),
  heic: () => pad(Buffer.from("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00", "latin1")),
  html: () => Buffer.from("<!doctype html><script>alert(document.cookie)</script>"),
  svg: () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  /** Valid GIF header followed by script: a classic polyglot. */
  gifPolyglot: () => Buffer.from("GIF89a/*<script>alert(1)</script>*/", "latin1"),
  exe: () => pad(Buffer.from("MZ\x90\x00", "latin1")),
};
