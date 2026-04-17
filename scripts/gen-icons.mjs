/**
 * Generates all favicon + social-embed images from src/icons/icon.png.
 *
 * Outputs (all written to public/):
 *   favicon.ico        – 16×16 + 32×32 multi-size ICO (browsers, bookmarks)
 *   favicon-32.png     – 32×32 PNG  (modern browsers prefer this over .ico)
 *   favicon-180.png    – 180×180 Apple touch icon
 *   favicon-192.png    – 192×192 Android / PWA
 *   og-image.png       – 1200×630 Open Graph image (Facebook, Discord, X/Twitter)
 */

import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "src/icons/icon.png");
const out = resolve(root, "public");

mkdirSync(out, { recursive: true });

// ── Helper ────────────────────────────────────────────────────────────────────

async function png(size, name) {
  await sharp(src)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(resolve(out, name));
  console.log(`  ✓  ${name}  (${size}×${size})`);
}

// ── PNG favicons ──────────────────────────────────────────────────────────────

await png(32,  "favicon-32.png");
await png(180, "favicon-180.png");
await png(192, "favicon-192.png");

// ── ICO (multi-size: 16 + 32) ─────────────────────────────────────────────────
// sharp can't write .ico natively, so we produce two PNGs then stitch with a
// tiny hand-rolled ICO encoder (no extra deps needed).

async function pngBuf(size) {
  return sharp(src)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

function writeIco(pngBuffers, destPath) {
  // ICO header: ICONDIR
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;

  // Calculate offsets
  let offset = headerSize;
  const entries = pngBuffers.map((buf) => {
    const entry = { buf, offset };
    offset += buf.length;
    return entry;
  });

  const totalSize = offset;
  const ico = Buffer.alloc(totalSize);

  // ICONDIR
  ico.writeUInt16LE(0, 0);      // reserved
  ico.writeUInt16LE(1, 2);      // type: 1 = ICO
  ico.writeUInt16LE(count, 4);  // image count

  // ICONDIRENTRY × count
  entries.forEach(({ buf, offset: imgOffset }, i) => {
    // Read actual size from PNG IHDR (bytes 16–23)
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    const base = 6 + i * 16;
    ico.writeUInt8(w >= 256 ? 0 : w, base);      // width  (0 = 256)
    ico.writeUInt8(h >= 256 ? 0 : h, base + 1);  // height (0 = 256)
    ico.writeUInt8(0, base + 2);   // colour count
    ico.writeUInt8(0, base + 3);   // reserved
    ico.writeUInt16LE(1, base + 4); // colour planes
    ico.writeUInt16LE(32, base + 6); // bits per pixel
    ico.writeUInt32LE(buf.length, base + 8);   // image data size
    ico.writeUInt32LE(imgOffset,  base + 12);  // image data offset
  });

  // Image data
  entries.forEach(({ buf, offset: imgOffset }) => {
    buf.copy(ico, imgOffset);
  });

  writeFileSync(destPath, ico);
}

const [buf16, buf32] = await Promise.all([pngBuf(16), pngBuf(32)]);
writeIco([buf16, buf32], resolve(out, "favicon.ico"));
console.log("  ✓  favicon.ico  (16×16 + 32×32)");

// ── OG image (1200×630) ───────────────────────────────────────────────────────
// Place the logo centred on a dark background matching the site theme (#0a0a0a).

const logoSize = 400;
const ogW = 1200;
const ogH = 630;

const logoBuf = await sharp(src)
  .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

await sharp({
  create: {
    width: ogW,
    height: ogH,
    channels: 4,
    background: { r: 10, g: 10, b: 10, alpha: 255 },
  },
})
  .composite([
    {
      input: logoBuf,
      left: Math.round((ogW - logoSize) / 2),
      top: Math.round((ogH - logoSize) / 2),
    },
  ])
  .png()
  .toFile(resolve(out, "og-image.png"));

console.log("  ✓  og-image.png  (1200×630)");

console.log("\nAll icons written to public/");
