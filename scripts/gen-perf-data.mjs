// 生成 N1 性能基线测试数据：随机噪声 PNG，目标文件大小落在 [min, max] MB 区间。
// 用法：
//   node scripts/gen-perf-data.mjs [--count 300] [--min-mb 1] [--max-mb 3] [--out sample-data/性能测试作品/第1话]
//
// 说明：随机 RGBA 噪声无法被 deflate 压缩，故 PNG 文件大小 ≈ 宽×高×4 字节，
//       可据此反推宽高尺寸，精确命中 1~3MB 区间，模拟真实大图（IPC 带宽 + 解码压力）。
import { deflateSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---- CRC32（PNG 块校验）----
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

// 生成 w×h 随机噪声 PNG（RGBA，每行 filter 字节 = 0）
function makeNoisePng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA

  const rowLen = 1 + w * 4;
  const raw = Buffer.alloc(h * rowLen);
  const px = randomBytes(w * h * 4);
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0; // filter: none
    px.copy(raw, y * rowLen + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- 参数解析 ----
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
}
const count = Math.max(1, parseInt(arg("--count", "300"), 10));
const minMb = parseFloat(arg("--min-mb", "1"));
const maxMb = parseFloat(arg("--max-mb", "3"));
const outDir = arg("--out", join("sample-data", "性能测试作品", "第1话"));
if (!(minMb > 0) || !(maxMb >= minMb)) {
  console.error("--min-mb / --max-mb 无效（需 0 < min-mb <= max-mb）");
  process.exit(1);
}

// 2:3 长宽比：文件大小 S ≈ w×h×4 = 1.5·w²×4 = 6·w²  →  w = sqrt(S/6)
function dimsFor(bytes) {
  const w = Math.max(1, Math.round(Math.sqrt(bytes / 6)));
  const h = Math.max(1, Math.round(w * 1.5));
  return [w, h];
}

mkdirSync(outDir, { recursive: true });

const started = Date.now();
let totalBytes = 0;
for (let i = 0; i < count; i++) {
  const targetMb = minMb + Math.random() * (maxMb - minMb);
  const bytes = targetMb * 1024 * 1024;
  const [w, h] = dimsFor(bytes);
  const png = makeNoisePng(w, h);
  totalBytes += png.length;
  const name = String(i + 1).padStart(3, "0") + ".png";
  writeFileSync(join(outDir, name), png);
  if ((i + 1) % 25 === 0) {
    console.log(`  ${i + 1}/${count} 张 …`);
  }
}
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `完成：${count} 张，共 ${(totalBytes / 1024 / 1024).toFixed(1)}MB，` +
    `均张 ${(totalBytes / count / 1024 / 1024).toFixed(2)}MB，耗时 ${secs}s → ${outDir}`
);