#!/usr/bin/env node
// Writes the files Maestro "picks" (src/dev/flags.ts) into test/fixtures/files/: table CSVs (good, German, bad, ambiguous),
// backup files that must be refused (foreign app, newer version, truncated JSON), and logos (valid, above 512 KB, not an image).
// Deterministic; overwrites in place and deletes nothing. Run: node scripts/fixtures/make-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'files');
fs.mkdirSync(dir, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(dir, name), data);

// v1.1 (REVIEW_V1 #20): INVENTED table values (no published table's numbers in any fixture); 1.5 → 20 keeps SPEC E3
write('table-good.csv', 'size_mm2,iz_a\n1.5,20\n2.5,28\n4,37\n6,48\n10,66\n');
write('table-de.csv', '﻿size_mm2;iz_a;\r\n1,5;20;\r\n2,5;28;\r\n4;37;\r\n6;48;\r\n');
write('table-bad.csv', 'size_mm2,iz_a\n1.5,20\n2.5,abc\n4,37\n');
write('table-ambiguous.csv', 'size_mm2,iz_a\n1.500,20\n2.5,28\n');

write('backup-foreign.json', JSON.stringify({ app: 'some-other-app', backupVersion: 1 }));
write('backup-newer.json', JSON.stringify({ app: 'electrician-toolkit', backupVersion: 99, schemaVersion: 2, exportedAt: '2026-10-03T10:00:00.000Z', engineVersion: '1.0.0', settings: {}, projects: [], circuits: [], calculations: [], cableTables: [], cableTableRows: [] }));
write('backup-broken.json', '{"app":"electrician-toolkit","backupVersion":1,"projects":[{"id":1,');

function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) pixel(x, y).forEach((v, i) => (raw[y * (w * 3 + 1) + 1 + x * 3 + i] = v));
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
write('logo.png', png(240, 72, (x, y) => (x < 3 || x >= 237 || y < 3 || y >= 69 ? [31, 35, 42] : Math.abs(x - 120 + (y - 36) * 0.6) < 10 && y > 12 && y < 60 ? [255, 196, 0] : [240, 240, 244])));
// deterministic noise: does not compress, so the PNG is above 512 KB
let seed = 2463534242; // xorshift32
const rnd = () => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed & 255;
};
write('logo-big.png', png(600, 400, () => [rnd(), rnd(), rnd()]));
write('not-image.png', 'This is plain text with a .png name, not an image.\n');
console.log('fixtures written to', dir);
