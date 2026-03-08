import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// --- Minimal PNG generator (solid color squares) ---

function crc32(data: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of data) {
    // biome-ignore lint/suspicious/noBitwiseOperators: CRC32
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      // biome-ignore lint/suspicious/noBitwiseOperators: CRC32
      crc = (crc >>> 1) ^ (crc & 1 ? 0xed_b8_83_20 : 0);
    }
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: CRC32
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const t = new TextEncoder().encode(type);
  const buf = new Uint8Array(12 + data.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, data.length);
  buf.set(t, 4);
  buf.set(data, 8);
  const forCrc = new Uint8Array(4 + data.length);
  forCrc.set(t);
  forCrc.set(data, 4);
  view.setUint32(8 + data.length, crc32(forCrc));
  return buf;
}

function solidPNG(r: number, g: number, b: number, size = 64): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, size);
  ihdrView.setUint32(4, size);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  const ihdr = pngChunk("IHDR", ihdrData);

  // Pixel data: each row = filter_byte(0) + size * RGB
  const rowLen = 1 + size * 3;
  const raw = new Uint8Array(size * rowLen);
  for (let y = 0; y < size; y++) {
    const off = y * rowLen;
    for (let x = 0; x < size; x++) {
      const px = off + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const compressed = deflateSync(Buffer.from(raw));
  const idat = pngChunk("IDAT", new Uint8Array(compressed));

  const iend = pngChunk("IEND", new Uint8Array(0));

  const result = new Uint8Array(
    sig.length + ihdr.length + idat.length + iend.length
  );
  let off = 0;
  result.set(sig, off);
  off += sig.length;
  result.set(ihdr, off);
  off += ihdr.length;
  result.set(idat, off);
  off += idat.length;
  result.set(iend, off);
  return result;
}

// --- Colors ---

const colors: Record<string, [number, number, number]> = {
  g: [46, 204, 113], // green  — active
  y: [241, 196, 15], // yellow — partially away
  r: [231, 76, 60], // red    — away
  n: [189, 195, 199], // gray   — no data
};

// --- Hour labels (must match report.ts emojiHourLabel) ---

function hourLabel(h: number): string {
  if (h === 0) {
    return "12am";
  }
  if (h < 12) {
    return `${h}am`;
  }
  if (h === 12) {
    return "12pm";
  }
  return `${h - 12}pm`;
}

// --- Generate ---

const outDir = "./emojis";
mkdirSync(outDir, { recursive: true });

let count = 0;
for (let h = 0; h < 24; h++) {
  const label = hourLabel(h);
  for (const [suffix, rgb] of Object.entries(colors)) {
    const name = `p-${label}-${suffix}`;
    const png = solidPNG(rgb[0], rgb[1], rgb[2]);
    writeFileSync(`${outDir}/${name}.png`, png);
    count++;
  }
}

console.log(`Generated ${count} emoji PNGs in ${outDir}/`);
console.log("");
console.log("Upload to Slack:");
console.log(
  "  1. Go to your workspace → Settings → Customize → Emoji → Add Custom Emoji"
);
console.log(
  "  2. Upload each PNG using the filename (without .png) as the emoji name"
);
console.log("");
console.log(
  "For bulk upload, try: https://github.com/smashwilson/slack-emojinator"
);
