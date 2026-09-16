/* テクノのビンゴ — 配色の検算（styles.css の :root を実際に読んで比を計算する）
 *   管理者指示（2026-09-16 10:44）「出ていない数字はもっと暗くしてほとんど読めないように」
 *   ＝ 未出のマスは背景に対してコントラスト比 1.3 以下。
 *   合わせて「出た／最新は遠目でもはっきり」も数字で担保する。
 *   実行: node scripts/contrast_test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "client", "public", "styles.css"), "utf8");

let ok = 0, ng = 0;
const check = (cond, msg) => { if (cond) ok++; else { ng++; console.error("  NG: " + msg); } };

/** :root の変数を実際の css から拾う（ここを直せば検算も追従する） */
function v(name) {
  const m = css.match(new RegExp("--" + name + "\\s*:\\s*([^;]+);"));
  if (!m) throw new Error("styles.css に --" + name + " が見つからない");
  return m[1].trim();
}

/** #rrggbb → WCAG の相対輝度 */
function lum(hex) {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
/** コントラスト比（1〜21） */
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
const r2 = (x) => Math.round(x * 100) / 100;

const bg = v("c-bg"), hit = v("c-hit"), latest = v("c-latest");
const onHit = v("c-on-hit"), onLatest = v("c-on-latest");
const offFg = v("cell-off-fg"), offBg = v("cell-off-bg");

// ① 未出は背景とほぼ同化（ここが今回の指示）
const rOff = ratio(offFg, bg);
check(rOff <= 1.3, `未出の数字 ${offFg} と背景 ${bg} の比が ${r2(rOff)}（1.3 以下にすること）`);
check(rOff >= 1.05, `未出が背景と完全に同じ（${r2(rOff)}）＝マスの位置すら分からない。少しだけ差を残す`);
check(offBg === "transparent", `未出のマスは塗らない（--cell-off-bg が ${offBg}）`);
check(!/\.bcell\s*\{[^}]*border\s*:/.test(css), "未出のマスに枠を描いていない");

// ② 出たマスは遠目でもはっきり（塗りと背景・塗りと文字）
const rHitBg = ratio(hit, bg), rOnHit = ratio(onHit, hit);
check(rHitBg >= 2.0, `出たマスの塗り ${hit} と背景の比が ${r2(rHitBg)}（2.0 以上）`);
check(rOnHit >= 3.0, `出たマスの文字 ${onHit} と塗りの比が ${r2(rOnHit)}（大きい文字の下限 3.0 以上）`);

// ③ 最新は出たマスとも背景とも見分けがつく
const rLatestHit = ratio(latest, hit), rOnLatest = ratio(onLatest, latest);
check(rLatestHit >= 2.0, `最新 ${latest} と出たマス ${hit} の比が ${r2(rLatestHit)}（2.0 以上）`);
check(rOnLatest >= 4.5, `最新の文字 ${onLatest} と塗りの比が ${r2(rOnLatest)}（4.5 以上）`);

// ④ 未出と出たマスの差が最大になっていること
check(ratio(offFg, hit) >= 3.0, "未出の数字と出たマスの塗りが十分に離れている");
check(rHitBg / rOff >= 2.5, "「塗られたマス」が「未出」よりはっきり浮き上がる");

console.log(
  "[contrast_test] 未出/背景=" + r2(rOff) +
  "（目標 1.3 以下） 塗り/背景=" + r2(rHitBg) +
  " 白文字/塗り=" + r2(rOnHit) +
  " 最新/塗り=" + r2(rLatestHit) +
  " 最新文字/最新=" + r2(rOnLatest)
);
console.log(`[contrast_test] 判定 ${ok} 件 PASS / ${ng} 件 NG`);
if (ng > 0) { console.error("[contrast_test] FAIL"); process.exit(1); }
console.log("[contrast_test] PASS");
