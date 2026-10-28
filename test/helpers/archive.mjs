// Build small zip and gzip files in memory for offline tests of the UN WPP and UN DESA readers.
import { deflateRawSync, gzipSync } from "node:zlib";

/** A zip archive (deflated entries, no CRC: the reader does not check it). files: { name: string | Buffer } (undefined = left out). */
export function makeZip(input) {
  const files = Object.fromEntries(Object.entries(input).filter(([, v]) => v != null));
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const data = deflateRawSync(raw);
    const n = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(cd, n);
    offset += local.length + n.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

export const gz = (text) => gzipSync(Buffer.from(text, "utf8"));

/** UN WPP-style CSV text from a header and rows of values (quotes fields with commas). */
export function wppCsv(header, rows) {
  const q = (v) => (v == null ? "" : /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return "﻿" + [header.join(","), ...rows.map((r) => header.map((h) => q(r[h])).join(","))].join("\r\n") + "\r\n";
}
