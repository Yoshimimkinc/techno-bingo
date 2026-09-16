/* テクノ⚡ビンゴ — 番号生成の検算
 *   1,000 ゲーム × 75 回引いて「重複ゼロ」「1〜75 を出し切る」「76 回目は null」を確かめる。
 *   実行: node scripts/pool_test.js
 */
"use strict";
const path = require("path");
const TB = require(path.join(__dirname, "..", "client", "public", "app.js"));

let ng = 0, ok = 0;
function check(cond, msg) {
  if (cond) { ok++; } else { ng++; console.error("  NG: " + msg); }
}

const GAMES = 1000, MAX = TB.MAX_NUMBER;
let worstMissing = 0;
const freq = new Array(MAX + 1).fill(0);   // 出現位置の偏りを見るための素データ

for (let g = 0; g < GAMES; g++) {
  const drawn = [];
  const seen = new Set();
  for (let i = 1; i <= MAX; i++) {
    const n = TB.drawNext(drawn, MAX);
    if (n === null) { check(false, `game ${g}: ${i} 回目で引けなくなった`); break; }
    if (seen.has(n)) { check(false, `game ${g}: ${n} が重複した（${i} 回目）`); }
    if (!Number.isInteger(n) || n < 1 || n > MAX) { check(false, `game ${g}: 範囲外 ${n}`); }
    if (TB.remaining(drawn, MAX).length !== MAX - drawn.length) {
      check(false, `game ${g}: 残り番号の数が合わない`);
    }
    seen.add(n); drawn.push(n);
    freq[n]++;
  }
  if (seen.size !== MAX) { worstMissing = Math.max(worstMissing, MAX - seen.size); }
  check(seen.size === MAX, `game ${g}: 出し切れていない（${seen.size}/${MAX}）`);
  check(drawn.length === MAX, `game ${g}: 件数が ${drawn.length}`);
  check(TB.drawNext(drawn, MAX) === null, `game ${g}: 76 回目が null でない`);
  check(TB.remaining(drawn, MAX).length === 0, `game ${g}: 残りが 0 でない`);
}

// 全番号が全ゲームで1回ずつ出ている＝合計は GAMES と一致するはず（＝重複ゼロの裏取り）
for (let n = 1; n <= MAX; n++) check(freq[n] === GAMES, `番号 ${n} の出現回数が ${freq[n]}（期待 ${GAMES}）`);

// B/I/N/G/O の割り当て
check(TB.letterOf(1) === "B" && TB.letterOf(15) === "B", "1,15 は B");
check(TB.letterOf(16) === "I" && TB.letterOf(30) === "I", "16,30 は I");
check(TB.letterOf(31) === "N" && TB.letterOf(45) === "N", "31,45 は N");
check(TB.letterOf(46) === "G" && TB.letterOf(60) === "G", "46,60 は G");
check(TB.letterOf(61) === "O" && TB.letterOf(75) === "O", "61,75 は O");

// 残り番号の基本
check(TB.remaining([], MAX).length === MAX, "初期の残りは 75");
check(TB.remaining([1, 2, 3], MAX).indexOf(1) === -1, "既出は残りに入らない");
// 乱数を端に寄せても範囲外にならない（下限・上限）
check(TB.drawNext([], MAX, () => 0) === 1, "乱数 0 → 最小の未出");
check(TB.drawNext([], MAX, () => 0.999999) === MAX, "乱数 ~1 → 最大の未出");
check(TB.drawNext([], MAX, () => 1) === MAX, "乱数 1（境界）でも範囲内");

/* ---- 盤面（プロジェクター表示の B/I/N/G/O × 15）の塗り判定 ---- */
{
  const rows0 = TB.boardRows([], MAX);
  check(rows0.length === 5, "盤面は 5 行");
  check(rows0.every((r) => r.cells.length === 15), "各行 15 列");
  check(rows0.map((r) => r.letter).join("") === "BINGO", "行の見出しは B I N G O");
  const all = [].concat(...rows0.map((r) => r.cells.map((c) => c.number)));
  check(all.length === MAX && new Set(all).size === MAX, "盤面に 1〜75 が重複なく 1 回ずつ");
  check(all.every((n, i) => n === i + 1), "左上から右下へ 1〜75 の順");
  check(rows0.every((r) => r.cells.every((c) => !c.hit && !c.latest)), "引く前は 1 つも塗られていない");
  check(rows0[0].cells[0].number === 1 && rows0[4].cells[14].number === 75, "B の左端が 1・O の右端が 75");

  // 75 件引き切ると全部塗れる。最新は 1 つだけ
  const drawn = [];
  for (let i = 1; i <= MAX; i++) {
    drawn.push(TB.drawNext(drawn, MAX));
    const rows = TB.boardRows(drawn, MAX);
    const cells = [].concat(...rows.map((r) => r.cells));
    check(cells.filter((c) => c.hit).length === i, `${i} 件目：塗られた数が ${i}`);
    check(cells.filter((c) => c.latest).length === 1, `${i} 件目：最新は 1 つだけ`);
    const lt = cells.find((c) => c.latest);
    check(lt && lt.number === drawn[drawn.length - 1] && lt.hit, `${i} 件目：最新が最後に引いた番号`);
  }
  check([].concat(...TB.boardRows(drawn, MAX).map((r) => r.cells)).every((c) => c.hit), "75 件で盤面が全部塗れる");

  // 取消すと 1 つ戻り、最新が前の番号に移る
  const removed = drawn.pop();
  const back = [].concat(...TB.boardRows(drawn, MAX).map((r) => r.cells));
  check(back.filter((c) => c.hit).length === MAX - 1, "取消で塗りが 1 つ減る");
  check(back.find((c) => c.number === removed).hit === false, "取り消した番号が未出に戻る");
  check(back.find((c) => c.latest).number === drawn[drawn.length - 1], "最新が 1 つ前の番号に移る");
}

console.log(`[pool_test] ${GAMES} ゲーム × ${MAX} 回 ＝ ${GAMES * MAX} 回引いた`);
console.log(`[pool_test] 判定 ${ok} 件 PASS / ${ng} 件 NG`);
if (ng > 0) { console.error("[pool_test] FAIL"); process.exit(1); }
console.log("[pool_test] PASS");
