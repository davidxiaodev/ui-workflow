// Just enough PNG to compare screenshots without dependencies: decode 8-bit, non-interlaced images
// (greyscale, RGB, palette, with or without alpha), compare two of them, and write a diff image.
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Decodes a PNG into { width, height, data } with data as RGBA bytes. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString("latin1", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === "PLTE") palette = body;
    else if (kind === "tRNS") trns = body;
    else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported (8 only)`);
  if (interlace) throw new Error("interlaced PNG is not supported");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`PNG colour type ${type} is not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      out[x] = v & 255;
    }
  }
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const d = i * 4;
    if (type === 6) pixels.copy(data, d, s, s + 4);
    else if (type === 2) {
      data[d] = pixels[s];
      data[d + 1] = pixels[s + 1];
      data[d + 2] = pixels[s + 2];
      data[d + 3] = 255;
    } else if (type === 0 || type === 4) {
      data[d] = data[d + 1] = data[d + 2] = pixels[s];
      data[d + 3] = type === 4 ? pixels[s + 1] : 255;
    } else {
      const idx = pixels[s];
      data[d] = palette[idx * 3];
      data[d + 1] = palette[idx * 3 + 1];
      data[d + 2] = palette[idx * 3 + 2];
      data[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { width, height, data };
}

/** Encodes RGBA bytes as a PNG. */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Compares two decoded images. A pixel differs when any channel differs by more than `threshold`
 * (0–255). `mask` is a list of [x, y, w, h] rectangles as fractions of the image (0–1) to ignore,
 * such as a clock. Returns { sameSize, diffPixels, ratio, diff } where diff is an RGBA image: the
 * expected image faded, differing pixels in red, masked areas in blue.
 */
export function comparePng(expected, actual, { threshold = 16, mask = [] } = {}) {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { sameSize: false, diffPixels: null, ratio: 1, diff: null };
  }
  const { width, height } = expected;
  const rects = mask.map(([x, y, w, h]) => [Math.floor(x * width), Math.floor(y * height), Math.ceil((x + w) * width), Math.ceil((y + h) * height)]);
  const diff = Buffer.alloc(width * height * 4);
  let diffPixels = 0;
  let counted = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) {
        diff.set([80, 120, 255, 255], i);
        continue;
      }
      counted++;
      const d = Math.max(
        Math.abs(expected.data[i] - actual.data[i]),
        Math.abs(expected.data[i + 1] - actual.data[i + 1]),
        Math.abs(expected.data[i + 2] - actual.data[i + 2]),
        Math.abs(expected.data[i + 3] - actual.data[i + 3]),
      );
      if (d > threshold) {
        diffPixels++;
        diff.set([255, 0, 0, 255], i);
      } else {
        const g = 255 - Math.round((255 - (expected.data[i] * 0.3 + expected.data[i + 1] * 0.59 + expected.data[i + 2] * 0.11)) * 0.25);
        diff.set([g, g, g, 255], i);
      }
    }
  }
  return { sameSize: true, diffPixels, ratio: counted ? diffPixels / counted : 0, diff: { width, height, data: diff } };
}

function chunk(kind, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const head = Buffer.from(kind, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head, body])) >>> 0);
  return Buffer.concat([len, head, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
