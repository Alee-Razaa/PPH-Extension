// Release build: verifies the extension, then zips src/ into dist/. Node built-ins only.
// Usage: npm run build
// Output: dist/pph-job-radar-<version>.zip  (manifest.json at the zip root, ready to unzip and Load unpacked,
// or to upload to the Chrome Web Store if you ever choose to publish).
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  console.error(`Version mismatch: manifest ${manifest.version}, package.json ${pkg.version}`);
  process.exit(1);
}

if (!process.argv.includes('--skip-tests')) {
  console.log('Running tests...');
  execFileSync(process.execPath, ['--test', 'tests/**/*.test.js'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('Tests passed.');
}

const walk = dir => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const files = walk(SRC)
  .map(full => ({ full, name: relative(SRC, full).split('\\').join('/') }))
  .filter(f => !/(^|\/)(\.|Thumbs\.db$|desktop\.ini$)/i.test(f.name))
  .sort((a, b) => a.name.localeCompare(b.name));

// ---- minimal ZIP writer (deflate, no data descriptors) ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// Fixed timestamp (2026-01-01 00:00) so identical sources give an identical zip.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const locals = [];
const centrals = [];
let offset = 0;
for (const { full, name } of files) {
  const data = readFileSync(full);
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);                   // UTF-8 names
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  locals.push(local, nameBuf, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(useDeflate ? 8 : 0, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + body.length;
}
const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

if (!existsSync(DIST)) mkdirSync(DIST);
const out = join(DIST, `pph-job-radar-${manifest.version}.zip`);
const zip = Buffer.concat([...locals, centralBuf, end]);
writeFileSync(out, zip);

const kb = (zip.length / 1024).toFixed(1);
console.log(`Built ${relative(ROOT, out)}: ${files.length} files, ${kb} KB (budget 1024 KB)`);
if (zip.length > 1024 * 1024) {
  console.error('Package is over the 1 MB budget (SPEC 19).');
  process.exit(1);
}
