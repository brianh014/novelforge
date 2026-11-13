import { deflateRawSync } from "node:zlib";

/**
 * A .zip holding one file, which Windows opens with no extra tools. The Windows downloads go in one, as compressed
 * they fit under the 100 MB a Cloudflare-fronted Gitea takes per upload.
 */
export function zip(name: string, data: Uint8Array, date = new Date()) {
  const packed = deflateRawSync(data, { level: 9 });
  const fileName = Buffer.from(name);
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  // The fields a local header and the central directory share: version needed, flags, deflate, time, date, CRC and sizes.
  const shared = Buffer.alloc(26);
  shared.writeUInt16LE(20, 0);
  shared.writeUInt16LE(0x0800, 2); // the name is UTF-8
  shared.writeUInt16LE(8, 4);
  shared.writeUInt16LE(time, 6);
  shared.writeUInt16LE(day, 8);
  shared.writeUInt32LE(Bun.hash.crc32(data), 10);
  shared.writeUInt32LE(packed.length, 14);
  shared.writeUInt32LE(data.length, 18);
  shared.writeUInt16LE(fileName.length, 22);

  const local = Buffer.alloc(4);
  local.writeUInt32LE(0x04034b50);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // made by
  shared.copy(central, 6);
  // Comment length, disk, attributes and the local header's offset, 0, stay 0.
  const centralStart = local.length + shared.length + fileName.length + packed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([local, shared, fileName, packed, central, fileName, end]);
}
