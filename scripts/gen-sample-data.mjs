// 生成测试样本漫画库：sample-data/示例作品/第N话/001.png ...
// 含非图片干扰文件，用于验证过滤与自然排序。运行：node scripts/gen-sample-data.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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

// 生成 w×h 纯色 PNG（宽高比 1.4，与阅读页估算高度一致，便于验证续读定位）
function makePng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 每话用不同颜色，方便目视区分当前话/图片
const COLORS = [
  [0x4f, 0x8c, 0xff],
  [0x57, 0xc7, 0x85],
  [0xc7, 0x7d, 0x57],
];

const root = join(process.cwd(), "sample-data", "示例作品");
for (let ch = 1; ch <= 3; ch++) {
  const dir = join(root, `第${ch}话`);
  mkdirSync(dir, { recursive: true });
  const png = makePng(300, 420, COLORS[(ch - 1) % COLORS.length]);
  for (let i = 1; i <= 12; i++) {
    writeFileSync(join(dir, `${i}.png`), png);
  }
  // 干扰文件：应被过滤
  writeFileSync(join(dir, "notes.txt"), "should be filtered out");
}
console.log("sample data generated at", root);
