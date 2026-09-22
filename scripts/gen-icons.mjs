// 将 src-tauri/icons/漫画.png 转为多分辨率 icon.ico（PNG-in-ICO 容器）
// 运行：node scripts/gen-icons.mjs
import { deflateSync, inflateSync } from "node:zlib";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- PNG 解码（colorType 6 / RGBA8；colorType 2 / RGB8 补全 alpha） ----------

// CRC32（PNG 块校验）
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG 文件");
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  if (buf[26] !== 0 || buf[28] !== 0)
    throw new Error("不支持压缩方法或隔行扫描");
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2))
    throw new Error(`仅支持 8bit RGBA/RGB，当前 depth=${bitDepth} type=${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  let off = 8;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") idat.push(buf.slice(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const rgba = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const rowOff = y * (stride + 1);
    const filter = raw[rowOff];
    for (let x = 0; x < stride; x++) {
      const v = raw[rowOff + 1 + x];
      const left = x >= channels ? cur[x - channels] : 0;
      const up = prev[x];
      const ul = x >= channels ? prev[x - channels] : 0;
      let out;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + left; break;
        case 2: out = v + up; break;
        case 3: out = v + ((left + up) >> 1); break;
        case 4: out = v + paeth(left, up, ul); break;
        default: throw new Error(`未知 PNG 过滤器 ${filter}`);
      }
      cur[x] = out & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const s = x * channels;
      const d = (y * w + x) * 4;
      rgba[d] = cur[s];
      rgba[d + 1] = cur[s + 1];
      rgba[d + 2] = cur[s + 2];
      rgba[d + 3] = channels === 4 ? cur[s + 3] : 255;
    }
    prev.set(cur);
  }
  return { w, h, rgba };
}

// ---------- 缩放（面积盒过滤：放大抗锯齿，缩小不丢细节） ----------

function sampleAt(src, sx, sy) {
  const x = Math.min(src.w - 1, Math.max(0, Math.floor(sx)));
  const y = Math.min(src.h - 1, Math.max(0, Math.floor(sy)));
  const p = (y * src.w + x) * 4;
  const a = src.rgba[p + 3] / 255;
  return [src.rgba[p] * a, src.rgba[p + 1] * a, src.rgba[p + 2] * a, src.rgba[p + 3]];
}

function resize(src, size) {
  const out = new Uint8Array(size * size * 4);
  const sx = src.w / size;
  const sy = src.h / size;
  const useAvg = sx > 1.5 || sy > 1.5; // 缩小超过 1.5 倍时用面积平均
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r, g, b, a;
      if (useAvg) {
        const x0 = x * sx, y0 = y * sy;
        let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
        for (let py = Math.floor(y0); py < Math.min(src.h, y0 + sy); py++) {
          for (let px = Math.floor(x0); px < Math.min(src.w, x0 + sx); px++) {
            const p = (py * src.w + px) * 4;
            const alpha = src.rgba[p + 3] / 255;
            sr += src.rgba[p] * alpha;
            sg += src.rgba[p + 1] * alpha;
            sb += src.rgba[p + 2] * alpha;
            sa += src.rgba[p + 3];
            n++;
          }
        }
        if (n === 0) { r = g = b = a = 0; }
        else {
          a = sa / n;
          const alpha = a / 255;
          r = alpha > 0 ? sr / n / alpha : 0;
          g = alpha > 0 ? sg / n / alpha : 0;
          b = alpha > 0 ? sb / n / alpha : 0;
        }
      } else {
        [r, g, b, a] = sampleAt(src, x * sx, y * sy);
        const alpha = a / 255;
        r = alpha > 0 ? r / alpha : 0;
        g = alpha > 0 ? g / alpha : 0;
        b = alpha > 0 ? b / alpha : 0;
      }
      const d = (y * size + x) * 4;
      out[d] = Math.round(Math.min(255, Math.max(0, r)));
      out[d + 1] = Math.round(Math.min(255, Math.max(0, g)));
      out[d + 2] = Math.round(Math.min(255, Math.max(0, b)));
      out[d + 3] = Math.round(Math.min(255, Math.max(0, a)));
    }
  }
  return { w: size, h: size, rgba: out };
}

// ---------- PNG 编码与 ICO 容器 ----------

function encodePng({ w, h, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4);
    raw[off] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4)
      .copy(raw, off + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let dataOff = 6 + pngs.length * 16;
  const entries = pngs.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 256 以 0 表示
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(dataOff, 12);
    dataOff += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
}

// ---------- 主流程 ----------

const srcPath = join(root, "src-tauri", "icons", "漫画.png");
const outDir = join(root, "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

const src = decodePng(readFileSync(srcPath));
console.log(`源图：${src.w}x${src.h} RGBA`);

// 尺寸：原图（不放大，避免放大模糊）+ 常用小尺寸（向下缩放保证清晰）
const sizes = [...new Set([src.w, 64, 48, 32, 16].filter((s) => s <= src.w))]
  .sort((a, b) => b - a);

const pngs = sizes.map((size) => {
  const img = size === src.w ? src : resize(src, size);
  return { size, png: encodePng(img) };
});

const outPath = join(outDir, "icon.ico");
writeFileSync(outPath, makeIco(pngs));
console.log(
  `icon.ico 生成完成：${sizes.join("/")}px，共 ${pngs.reduce((s, p) => s + p.png.length, 0)} 字节`,
  "→",
  outPath
);
