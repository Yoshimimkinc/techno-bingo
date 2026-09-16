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

/* ① ロゴ SVG（v06b で画像の貼り付けをやめ、SVG で描き直した） */
const SVG = path.join(PUB, "logo.svg");
check(fs.existsSync(SVG), "client/public/logo.svg が無い");
let svg = "", kbSvg = 0, nPath = 0;
if (fs.existsSync(SVG)) {
  svg = read(SVG); kbSvg = kb(SVG);
  nPath = (svg.match(/<path/g) || []).length;
  check(kbSvg <= 80, `logo.svg が ${kbSvg.toFixed(1)}KB（80KB 以下にすること）`);
  check(kbSvg > 3, `logo.svg が ${kbSvg.toFixed(1)}KB（中身が足りない可能性）`);
  check(nPath >= 4, `<path が ${nPath} 個（文字・⚡・星で 4 個以上のはず）`);
  check(/<linearGradient/.test(svg), "linearGradient が無い（文字のグラデが出ない）");
  check(/<title>テクノ⚡ビンゴ<\/title>/.test(svg), "SVG の <title> が「テクノ⚡ビンゴ」でない");
  check(/aria-label="テクノ⚡ビンゴ"/.test(svg), "SVG に aria-label が無い");
  check(/shape-rendering="crispEdges"/.test(svg), "ピクセル感の crispEdges が無い");
  // 外部参照が無い＝オフラインでも崩れない
  check(!/<image/.test(svg), "SVG が外部画像を参照している");
  check(!/@font-face|font-family/.test(svg), "SVG がフォントに依存している（アウトライン化するべき）");
  check(!/https?:\/\//.test(svg.replace(/xmlns="[^"]*"/g, "")), "SVG に外部 URL が残っている");
}
check(!fs.existsSync(IMG), "client/public/img/ が残っている（v06b で廃止）");

/* ② 両画面がロゴ SVG を参照しているか */
const host = read(path.join(PUB, "host.html"));
const guest = read(path.join(PUB, "index.html"));
for (const [name, html] of [["host.html", host], ["index.html", guest]]) {
  check((html.match(/src="\.\/logo\.svg"/g) || []).length === 2, `${name} の logo.svg の参照が 2 箇所でない`);
  check(!/img\//.test(html), `${name} に古い img/ の参照が残っている`);
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

console.log("[assets_test] logo.svg=" + kbSvg.toFixed(1) + "KB / path=" + nPath);
console.log(`[assets_test] 判定 ${ok} 件 PASS / ${ng} 件 NG`);
if (ng > 0) { console.error("[assets_test] FAIL"); process.exit(1); }
console.log("[assets_test] PASS");
