/* テクノ⚡ビンゴ — 配布物の検算（ロゴ画像と表題の表記）
 *   v06 でロゴが支給画像になったので、「画像が揃っているか」「両画面が参照しているか」
 *   「表題が ⚡ で統一されているか」を機械で見る。
 *   実行: node scripts/assets_test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "client", "public");
const IMG = path.join(PUB, "img");

let ok = 0, ng = 0;
const check = (cond, msg) => { if (cond) ok++; else { ng++; console.error("  NG: " + msg); } };
const read = (p) => fs.readFileSync(p, "utf8");
const kb = (p) => fs.statSync(p).size / 1024;

/* ① 画像が揃っていて、1 枚 150KB 以下か */
const NEED = ["hero.webp", "hero-720.webp", "hero.jpg", "logo.webp", "logo-720.webp", "logo.jpg"];
const sizes = [];
for (const f of NEED) {
  const p = path.join(IMG, f);
  const exists = fs.existsSync(p);
  check(exists, `client/public/img/${f} が無い`);
  if (!exists) continue;
  const s = kb(p);
  sizes.push(f + "=" + s.toFixed(0) + "KB");
  check(s <= 150, `${f} が ${s.toFixed(0)}KB（150KB 以下にすること）`);
  check(s > 4, `${f} が ${s.toFixed(0)}KB（壊れている可能性）`);
}

/* ② 両画面がロゴを参照しているか */
const host = read(path.join(PUB, "host.html"));
const guest = read(path.join(PUB, "index.html"));
for (const [name, html] of [["host.html", host], ["index.html", guest]]) {
  check(/img\/hero(-720)?\.(webp|jpg)/.test(html), `${name} が hero 画像を参照していない`);
  check(/img\/logo(-720)?\.(webp|jpg)/.test(html), `${name} が logo 画像を参照していない`);
  check(html.includes('type="image/webp"'), `${name} に webp の <source> が無い`);
  check(/<img[^>]+src="\.\/img\/[^"]+\.jpg"/.test(html), `${name} に webp 非対応向けの jpg フォールバックが無い`);
  check((html.match(/alt="テクノ⚡ビンゴ"/g) || []).length >= 1, `${name} の alt が「テクノ⚡ビンゴ」でない`);
  check(/<img[^>]+width="\d+"[^>]+height="\d+"/.test(html), `${name} の <img> に width/height が無い（読み込み中に画面が飛ぶ）`);
}

/* ③ 表題は ⚡ で統一（☆ や旧表記が残っていないか） */
const app = read(path.join(PUB, "app.js"));
check(/TB\.TITLE = "テクノ⚡ビンゴ";/.test(app), "app.js の TB.TITLE が「テクノ⚡ビンゴ」でない");
check(host.includes("<title>テクノ⚡ビンゴ（ホスト側）</title>"), "host.html の <title> が ⚡ でない");
check(guest.includes("<title>テクノ⚡ビンゴ</title>"), "index.html の <title> が ⚡ でない");
for (const [name, txt] of [["host.html", host], ["index.html", guest], ["app.js", app],
                           ["styles.css", read(path.join(PUB, "styles.css"))],
                           ["server/src/index.js", read(path.join(ROOT, "server", "src", "index.js"))],
                           ["README.md", read(path.join(ROOT, "README.md"))]]) {
  check(!txt.includes("テクノ☆ビンゴ"), `${name} に古い表記「テクノ☆ビンゴ」が残っている`);
}

/* ④ 会社名・社員名を公開物に出さない（🟢緑を保つ） */
const NG_WORDS = ["宮川", "mkinc", "MK x MTT", "テクノ協同組合"];
for (const [name, txt] of [["host.html", host], ["index.html", guest], ["app.js", app]]) {
  for (const w of NG_WORDS) check(!txt.includes(w), `${name} に「${w}」が入っている（公開物には出さない）`);
}

console.log("[assets_test] " + sizes.join(" / "));
console.log(`[assets_test] 判定 ${ok} 件 PASS / ${ng} 件 NG`);
if (ng > 0) { console.error("[assets_test] FAIL"); process.exit(1); }
console.log("[assets_test] PASS");
