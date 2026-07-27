/**
 * Rebuilds the platform icons from build/icon.png (1024x1024).
 *
 *   node scripts/make-icons.mjs
 *
 * macOS: build/icon.icns via sips + iconutil (macOS only).
 * Windows: build/icon.ico assembled here, so no extra tool is needed.
 * The source artwork lives in build/icon.html and is rendered in a browser.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { platform } from 'node:process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SOURCE = 'build/icon.png';
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_SIZES = [16, 32, 64, 128, 256, 512];

async function resize(size, out) {
  await run('sips', ['-z', String(size), String(size), SOURCE, '--out', out]);
}

/** ICO is a thin container: a directory of entries followed by PNG payloads. */
async function buildIco(files) {
  const images = await Promise.all(
    files.map(async (f) => ({ size: f.size, data: await readFile(f.path) })),
  );
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2); // palette size
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.data.length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

if (platform !== 'darwin') {
  console.error('Для изменения размеров нужен sips, он есть только в macOS.');
  process.exit(1);
}

const temp = 'build/.icon-work';
await rm(temp, { recursive: true, force: true });
await mkdir(temp, { recursive: true });

// Windows
const icoFiles = [];
for (const size of ICO_SIZES) {
  const path = `${temp}/ico-${size}.png`;
  await resize(size, path);
  icoFiles.push({ size, path });
}
await writeFile('build/icon.ico', await buildIco(icoFiles));
console.log('build/icon.ico готов');

// macOS
const iconset = `${temp}/icon.iconset`;
await mkdir(iconset, { recursive: true });
for (const size of ICNS_SIZES) {
  await resize(size, `${iconset}/icon_${size}x${size}.png`);
  await resize(size * 2, `${iconset}/icon_${size}x${size}@2x.png`);
}
await run('iconutil', ['-c', 'icns', iconset, '-o', 'build/icon.icns']);
console.log('build/icon.icns готов');

await rm(temp, { recursive: true, force: true });
