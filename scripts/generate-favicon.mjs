/**
 * Generate SpriteBrew favicon (32x32 ICO) and apple-touch-icon (180x180 PNG)
 * using only Node.js built-ins — no external dependencies.
 *
 * Pixel art: a small potion bottle in amber/orange tones on transparent bg.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ── Color palette ──
const T = [0, 0, 0, 0];           // transparent
const K = [30, 27, 24, 255];      // dark outline (#1e1b18)
const C = [139, 115, 85, 255];    // cork brown
const N = [100, 80, 55, 255];     // dark cork
const G = [180, 140, 80, 180];    // glass body (semi-transparent amber)
const D = [150, 110, 50, 200];    // darker glass
const L = [232, 153, 31, 255];    // liquid amber (#e8991f)
const A = [212, 135, 28, 255];    // accent amber (#d4871c)
const H = [255, 200, 100, 180];   // highlight
const B = [255, 255, 255, 150];   // bubble
const S = [255, 220, 140, 100];   // shine
const R = [180, 100, 20, 255];    // dark liquid

// ── 32×32 pixel art ──
// Each row is 32 pixels wide
const art = [
  //0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31
  [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T], // 0
  [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T], // 1
  [T, T, T, T, T, T, T, T, T, T, T, T, K, K, K, K, K, K, K, K, T, T, T, T, T, T, T, T, T, T, T, T], // 2
  [T, T, T, T, T, T, T, T, T, T, T, K, N, N, C, C, C, C, N, N, K, T, T, T, T, T, T, T, T, T, T, T], // 3
  [T, T, T, T, T, T, T, T, T, T, T, K, C, C, C, C, C, C, C, C, K, T, T, T, T, T, T, T, T, T, T, T], // 4
  [T, T, T, T, T, T, T, T, T, T, T, T, K, K, K, K, K, K, K, K, T, T, T, T, T, T, T, T, T, T, T, T], // 5
  [T, T, T, T, T, T, T, T, T, T, T, T, K, G, G, G, G, G, G, K, T, T, T, T, T, T, T, T, T, T, T, T], // 6
  [T, T, T, T, T, T, T, T, T, T, T, K, G, G, S, G, G, G, G, G, K, T, T, T, T, T, T, T, T, T, T, T], // 7
  [T, T, T, T, T, T, T, T, T, T, K, G, G, S, G, G, G, G, G, G, G, K, T, T, T, T, T, T, T, T, T, T], // 8
  [T, T, T, T, T, T, T, T, T, K, G, G, S, G, G, G, G, G, G, G, G, G, K, T, T, T, T, T, T, T, T, T], // 9
  [T, T, T, T, T, T, T, T, K, D, G, G, G, G, G, G, G, G, G, G, G, G, D, K, T, T, T, T, T, T, T, T], // 10
  [T, T, T, T, T, T, T, T, K, D, G, G, G, G, G, G, G, G, G, G, G, G, D, K, T, T, T, T, T, T, T, T], // 11
  [T, T, T, T, T, T, T, T, K, D, G, G, G, G, G, G, G, G, G, G, G, G, D, K, T, T, T, T, T, T, T, T], // 12
  [T, T, T, T, T, T, T, T, K, D, S, G, G, G, G, G, G, G, G, G, G, G, D, K, T, T, T, T, T, T, T, T], // 13
  [T, T, T, T, T, T, T, T, K, D, A, A, A, A, A, A, A, A, A, A, A, A, D, K, T, T, T, T, T, T, T, T], // 14  ← liquid line
  [T, T, T, T, T, T, T, T, K, D, L, L, A, L, L, L, L, L, L, A, L, L, D, K, T, T, T, T, T, T, T, T], // 15
  [T, T, T, T, T, T, T, T, K, D, L, L, L, L, L, B, L, L, L, L, L, L, D, K, T, T, T, T, T, T, T, T], // 16
  [T, T, T, T, T, T, T, T, K, D, L, L, L, L, L, L, L, L, B, L, L, L, D, K, T, T, T, T, T, T, T, T], // 17
  [T, T, T, T, T, T, T, T, K, D, L, L, L, B, L, L, L, L, L, L, L, L, D, K, T, T, T, T, T, T, T, T], // 18
  [T, T, T, T, T, T, T, T, K, D, L, L, L, L, L, L, L, L, L, L, L, L, D, K, T, T, T, T, T, T, T, T], // 19
  [T, T, T, T, T, T, T, T, K, D, L, L, L, L, L, L, B, L, L, L, L, L, D, K, T, T, T, T, T, T, T, T], // 20
  [T, T, T, T, T, T, T, T, K, D, L, L, L, L, L, L, L, L, L, L, L, L, D, K, T, T, T, T, T, T, T, T], // 21
  [T, T, T, T, T, T, T, T, K, D, R, L, L, L, L, L, L, L, L, L, L, R, D, K, T, T, T, T, T, T, T, T], // 22
  [T, T, T, T, T, T, T, T, K, D, R, R, L, L, L, L, L, L, L, L, R, R, D, K, T, T, T, T, T, T, T, T], // 23
  [T, T, T, T, T, T, T, T, K, D, R, R, R, L, L, L, L, L, L, R, R, R, D, K, T, T, T, T, T, T, T, T], // 24
  [T, T, T, T, T, T, T, T, K, K, D, R, R, R, R, R, R, R, R, R, R, D, K, K, T, T, T, T, T, T, T, T], // 25
  [T, T, T, T, T, T, T, T, T, K, K, K, K, K, K, K, K, K, K, K, K, K, K, T, T, T, T, T, T, T, T, T], // 26
  [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T], // 27
  [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T], // 28
  [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T], // 29
  [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T], // 30
  [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T], // 31
];

// ── PNG encoder (minimal, RGBA) ──

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([len, typeBytes, data, crc]);
}

function createPNG(pixels, width, height) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: raw pixel rows with filter byte 0 (None) per row
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(Buffer.from([0])); // filter: None
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) {
      const px = pixels[y][x];
      row[x * 4] = px[0];
      row[x * 4 + 1] = px[1];
      row[x * 4 + 2] = px[2];
      row[x * 4 + 3] = px[3];
    }
    rawRows.push(row);
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = deflateSync(rawData);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── ICO encoder (wraps a PNG) ──

function createICO(pngBuf, width, height) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(1, 4); // image count

  // Directory entry: 16 bytes
  const entry = Buffer.alloc(16);
  entry[0] = width >= 256 ? 0 : width;
  entry[1] = height >= 256 ? 0 : height;
  entry[2] = 0;  // color palette
  entry[3] = 0;  // reserved
  entry.writeUInt16LE(1, 4);  // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8);  // size of PNG data
  entry.writeUInt32LE(6 + 16, 12);        // offset to PNG data

  return Buffer.concat([header, entry, pngBuf]);
}

// ── Scale up pixel art (nearest-neighbor) ──

function scalePixels(pixels, srcW, srcH, dstW, dstH) {
  const scaled = [];
  for (let y = 0; y < dstH; y++) {
    const row = [];
    const srcY = Math.floor(y * srcH / dstH);
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.floor(x * srcW / dstW);
      row.push(pixels[srcY][srcX]);
    }
    scaled.push(row);
  }
  return scaled;
}

// ── Apple touch icon: add solid background behind the bottle ──

function addBackground(pixels, w, h, bgColor) {
  return pixels.map(row =>
    row.map(px => {
      if (px[3] === 0) return bgColor;
      if (px[3] < 255) {
        // Alpha-blend onto background
        const a = px[3] / 255;
        return [
          Math.round(px[0] * a + bgColor[0] * (1 - a)),
          Math.round(px[1] * a + bgColor[1] * (1 - a)),
          Math.round(px[2] * a + bgColor[2] * (1 - a)),
          255,
        ];
      }
      return px;
    })
  );
}

// ── Generate ──

const rootDir = resolve(import.meta.dirname, '..');

// 32×32 favicon.ico
const png32 = createPNG(art, 32, 32);
const ico = createICO(png32, 32, 32);
const faviconPath = resolve(rootDir, 'src/app/favicon.ico');
mkdirSync(dirname(faviconPath), { recursive: true });
writeFileSync(faviconPath, ico);
console.log(`✓ favicon.ico (${ico.length} bytes)`);

// 180×180 apple-touch-icon with solid dark bg
const scaled = scalePixels(art, 32, 32, 180, 180);
const bgColor = [18, 16, 16, 255]; // --bg-primary
const withBg = addBackground(scaled, 180, 180, bgColor);
const png180 = createPNG(withBg, 180, 180);
const applePath = resolve(rootDir, 'src/app/apple-icon.png');
writeFileSync(applePath, png180);
console.log(`✓ apple-icon.png (${png180.length} bytes)`);

console.log('Done!');
