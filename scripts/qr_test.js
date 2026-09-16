/* テクノ⚡ビンゴ — 自前 QR 生成の検算
 *   外部ライブラリを使わないので、次の 3 本で裏を取る。
 *   ① 形式情報・型番情報の BCH が JIS の公表値と一致するか
 *   ② 切り出し／タイミング／常に黒のモジュールが規定位置にあるか
 *   ③ 作った matrix を「読み手と同じ手順」で逆にたどって元の文字列に戻るか
 *      （マスク解除 → デインターリーブ → RS 再計算の照合 → byte モード復号）
 *   実行: node scripts/qr_test.js
 */
"use strict";
const path = require("path");
const TB = require(path.join(__dirname, "..", "client", "public", "app.js"));
const QR = TB.qr;

let ng = 0, ok = 0;
function check(cond, msg) { if (cond) ok++; else { ng++; console.error("  NG: " + msg); } }

/* ① BCH（JIS X 0510 の公表値） */
// 誤り訂正レベル M の形式情報 8 通り（公表値）
const FORMAT_M = [
  "101010000010010", "101000100100101", "101111001111100", "101101101001011",
  "100010111111001", "100000011001110", "100111110010111", "100101010100000"
];
FORMAT_M.forEach((s, i) => check(QR.bchFormat(i) === parseInt(s, 2), `形式情報 M/マスク${i}`));
// 型番情報（型番7以上）
const VERSION_INFO = {
  7: "000111110010010100", 8: "001000010110111100",
  9: "001001101010011001", 10: "001010010011010011"
};
Object.keys(VERSION_INFO).forEach((v) =>
  check(QR.bchVersion(Number(v)) === parseInt(VERSION_INFO[v], 2), `型番情報 ${v}`));

/* GF(256) と RS（再計算用・生成側と同じ定義を独立に書く） */
const EXP = new Array(512), LOG = new Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let j = 255; j < 512; j++) EXP[j] = EXP[j - 255]; }
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
function polyMul(a, b) { const r = new Array(a.length + b.length - 1).fill(0); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] ^= gmul(a[i], b[j]); return r; }
function genPoly(n) { let g = [1]; for (let i = 0; i < n; i++) g = polyMul(g, [1, EXP[i]]); return g; }
function rsEncode(data, ecLen) {
  const gen = genPoly(ecLen), res = data.concat(new Array(ecLen).fill(0));
  for (let i = 0; i < data.length; i++) { const c = res[i]; if (c) for (let j = 1; j < gen.length; j++) res[i + j] ^= gmul(gen[j], c); }
  return res.slice(data.length);
}

const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0
];

function utf8Decode(bytes) { return Buffer.from(bytes).toString("utf8"); }

/* ②③ 1 本の文字列を作って逆にたどる */
function roundTrip(text, label) {
  const qr = QR.encode(text);
  const size = qr.size, m = qr.modules;

  // ② 規定位置の確認
  check(size === qr.version * 4 + 17, `${label}: 一辺 ${size}`);
  const corners = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (const [r, c] of corners) {
    check(m[r][c] && m[r + 6][c] && m[r][c + 6] && m[r + 6][c + 6], `${label}: 切り出しパターンの角`);
    check(m[r + 3][c + 3] === true, `${label}: 切り出しパターンの芯`);
    check(m[r + 1][c + 1] === false, `${label}: 切り出しパターンの白枠`);
  }
  for (let k = 8; k < size - 8; k++) {
    check(m[6][k] === (k % 2 === 0), `${label}: 横タイミング ${k}`);
    check(m[k][6] === (k % 2 === 0), `${label}: 縦タイミング ${k}`);
  }
  check(m[size - 8][8] === true, `${label}: 常に黒のモジュール`);

  // ③ マスク解除しながらデータ経路をたどる
  const maskFn = MASKS[qr.mask];
  const bits = qr.path.map(([r, c]) => (maskFn(r, c) ? !m[r][c] : m[r][c]) ? 1 : 0);
  const cw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    cw.push(b);
  }
  check(cw.length >= qr.codewords.length, `${label}: 読み出したコード語が足りない`);
  check(qr.codewords.every((v, i) => v === cw[i]), `${label}: 配置→読み出しでコード語が一致`);

  // デインターリーブ
  const r0 = qr.rs, ecLen = qr.ecLen;
  const sizes = [];
  for (let i = 0; i < r0[1]; i++) sizes.push(r0[2]);
  for (let i = 0; i < r0[3]; i++) sizes.push(r0[4]);
  const maxData = Math.max.apply(null, sizes);
  const blocks = sizes.map((s) => new Array(s));
  let p = 0;
  for (let i = 0; i < maxData; i++) for (let j = 0; j < sizes.length; j++) if (i < sizes[j]) blocks[j][i] = cw[p++];
  const ecs = [];
  for (let i = 0; i < ecLen; i++) for (let j = 0; j < sizes.length; j++) { (ecs[j] = ecs[j] || [])[i] = cw[p++]; }

  // RS の再計算が一致するか（誤り訂正語が正しく載っているか）
  for (let j = 0; j < blocks.length; j++) {
    const calc = rsEncode(blocks[j], ecLen);
    check(calc.every((v, i) => v === ecs[j][i]), `${label}: ブロック${j} の誤り訂正語`);
  }

  // byte モードの復号
  const data = [].concat.apply([], blocks);
  const db = [];
  for (const b of data) for (let q = 7; q >= 0; q--) db.push((b >> q) & 1);
  let pos = 0;
  const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | db[pos++]; return v; };
  check(take(4) === 4, `${label}: byte モード指示子`);
  const len = take(qr.version < 10 ? 8 : 16);
  const out = [];
  for (let i = 0; i < len; i++) out.push(take(8));
  check(utf8Decode(out) === text, `${label}: 復号結果が元の文字列と一致`);
  return qr;
}

const urls = [
  ["https://techno-bingo.example.workers.dev/?g=techno-20260930", "実運用の客用URL"],
  ["A", "1文字"],
  ["https://example.com/", "短いURL"],
  ["x".repeat(60), "60バイト"],
  ["x".repeat(120), "120バイト"],
  ["テクノのビンゴ 参加者用", "日本語（UTF-8）"]
];
const used = {};
for (const [u, label] of urls) { const qr = roundTrip(u, label); used[label] = "型番" + qr.version + "/マスク" + qr.mask; }

// 容量の境界（型番が繰り上がること）
check(QR.capacityBytes(1) === 14 && QR.capacityBytes(10) === 213, "容量表（型番1=14／型番10=213 バイト）");
check(QR.encode("x".repeat(14)).version === 1, "14 バイトは型番1");
check(QR.encode("x".repeat(15)).version === 2, "15 バイトは型番2");
let over = false;
try { QR.encode("x".repeat(400)); } catch (e) { over = true; }
check(over, "容量超過は握り潰さずエラーにする");

console.log("[qr_test] " + Object.keys(used).map((k) => k + "=" + used[k]).join(" / "));
console.log(`[qr_test] 判定 ${ok} 件 PASS / ${ng} 件 NG`);
if (ng > 0) { console.error("[qr_test] FAIL"); process.exit(1); }
console.log("[qr_test] PASS");
