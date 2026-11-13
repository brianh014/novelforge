import { expect, test } from "bun:test";
import { inflateRawSync } from "node:zlib";
import { zip } from "../scripts/zip";

test("a zip holds its one file, deflated, with the CRC and sizes an unzipper checks", () => {
  const data = new TextEncoder().encode("NovelForge ".repeat(1000));
  const bytes = zip("NovelForge.exe", data, new Date(2026, 10, 12, 21, 30, 10));
  const view = Buffer.from(bytes);

  expect(view.readUInt32LE(0)).toBe(0x04034b50);
  const packedSize = view.readUInt32LE(18);
  const nameLength = view.readUInt16LE(26);
  expect(view.subarray(30, 30 + nameLength).toString()).toBe("NovelForge.exe");
  const packed = view.subarray(30 + nameLength, 30 + nameLength + packedSize);
  expect(new Uint8Array(inflateRawSync(packed))).toEqual(data);
  expect(view.readUInt32LE(14)).toBe(Bun.hash.crc32(data));
  expect(view.readUInt32LE(22)).toBe(data.length);

  // The end record points at the central directory, which names the same file.
  const end = view.length - 22;
  expect(view.readUInt32LE(end)).toBe(0x06054b50);
  const central = view.readUInt32LE(end + 16);
  expect(view.readUInt32LE(central)).toBe(0x02014b50);
  expect(view.subarray(central + 46, central + 46 + nameLength).toString()).toBe("NovelForge.exe");
});
