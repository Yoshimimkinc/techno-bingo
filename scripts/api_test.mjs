/* テクノ⚡ビンゴ — /api の検算（Durable Object を偽物に差し替えて Worker を直接叩く）
 *   docs/05_ARCHITECTURE_DESIGN.md の API 表どおりか、PIN・409・ETag/304・sync を確かめる。
 *   実行: node scripts/api_test.mjs   （Node 18 以上。Request/Response/crypto.subtle を使う）
 */
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(here, "..", "server", "src", "index.js")).href);
const worker = mod.default;
const BingoGame = mod.BingoGame;

let ok = 0, ng = 0;
const check = (cond, msg) => { if (cond) ok++; else { ng++; console.error("  NG: " + msg); } };

/* Durable Object の偽物：ゲーム ID ごとに 1 インスタンス（＝本番と同じ強整合のふるまい）。
   ストレージは Map。値は毎回コピーして渡し、保存していない書き換えが漏れないようにする。 */
function fakeNamespace(cls) {
  const instances = new Map();
  return {
    idFromName(name) { return { name }; },
    get(id) {
      let inst = instances.get(id.name);
      if (!inst) {
        const mem = new Map();
        const storage = {
          async get(k) { return mem.has(k) ? structuredClone(mem.get(k)) : undefined; },
          async put(k, v) { mem.set(k, structuredClone(v)); },
          async delete(k) { mem.delete(k); }
        };
        inst = new cls({ storage }, {});
        instances.set(id.name, inst);
      }
      return { fetch: (req) => inst.fetch(req) };
    }
  };
}
const env = { GAME: fakeNamespace(BingoGame) };
const GID = "techno-20260930";

async function call(method, p, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
  const res = await worker.fetch(new Request("https://example.test" + p, init), env);
  let data = null;
  if (res.status !== 304) { const t = await res.text(); try { data = t ? JSON.parse(t) : null; } catch { data = null; } }
  return { status: res.status, etag: res.headers.get("ETag"), data, cc: res.headers.get("Cache-Control") };
}
const G = (p = "") => "/api/game/" + GID + p;

/* --- ゲームが無い状態 --- */
check((await call("GET", G())).status === 404, "未開始は GET 404");
check((await call("POST", G("/draw"), { pin: "1234", seq: 1, number: 5 })).status === 404, "未開始は draw 404");
check((await call("GET", "/api/game/なまえ")).status === 400, "不正なゲーム ID は 400");
check((await call("GET", G("/draw"))).status === 405, "GET で draw は 405");

/* --- reset（PIN 登録） --- */
check((await call("POST", G("/reset"), { pin: "12" })).status === 400, "PIN 4桁でなければ 400");
let r = await call("POST", G("/reset"), { pin: "1234", title: "テクノのビンゴ" });
check(r.status === 200 && r.data.ok && r.data.draws.length === 0, "reset で新規ゲーム");
check(r.data.game.max_number === 75 && r.data.game.status === "ready", "初期値 75／ready");
check(r.data.game.pin_hash === undefined, "PIN のハッシュを外に出さない");

/* --- GET と ETag/304 --- */
r = await call("GET", G());
const etag1 = r.etag;
check(r.status === 200 && etag1 === '"' + r.data.game.version + '"', "ETag は version");
check((await call("GET", G(), null, { "If-None-Match": etag1 })).status === 304, "同じ ETag なら 304");
check((await call("GET", G(), null, { "If-None-Match": '"0"' })).status === 200, "違う ETag なら 200");

/* --- 携帯の HTTP キャッシュに拾わせない（v05） --- */
{
  const g = await call("GET", G());
  check(g.cc === "no-store", `GET state の Cache-Control が ${g.cc}（no-store であること）`);
  const nm = await call("GET", G(), null, { "If-None-Match": g.etag });
  check(nm.status === 304 && nm.cc === "no-store", "304 にも no-store が付く");
}

/* --- PIN --- */
check((await call("POST", G("/draw"), { pin: "9999", seq: 1, number: 5 })).status === 401, "PIN 違いは 401");
check((await call("POST", G("/undo"), { pin: "9999" })).status === 401, "undo も PIN で守る");
check((await call("POST", G("/reset"), { pin: "9999" })).status === 401, "既存ゲームの reset も PIN が要る");

/* --- draw --- */
r = await call("POST", G("/draw"), { pin: "1234", seq: 1, number: 42 });
check(r.status === 200 && r.data.draws.length === 1 && r.data.draws[0].number === 42, "1 件目を登録");
check(r.data.game.status === "playing", "status が playing");
check((await call("POST", G("/draw"), { pin: "1234", seq: 1, number: 7 })).status === 409, "seq が戻ると 409");
check((await call("POST", G("/draw"), { pin: "1234", seq: 3, number: 7 })).status === 409, "seq が飛ぶと 409");
check((await call("POST", G("/draw"), { pin: "1234", seq: 2, number: 42 })).status === 409, "既出番号は 409");
check((await call("POST", G("/draw"), { pin: "1234", seq: 2, number: 76 })).status === 400, "76 は範囲外 400");
check((await call("POST", G("/draw"), { pin: "1234", seq: 2, number: 0 })).status === 400, "0 は範囲外 400");
r = await call("POST", G("/draw"), { pin: "1234", seq: 2, number: 7 });
check(r.status === 200 && r.data.draws.length === 2, "2 件目を登録");
check(r.etag !== etag1, "書き込むと ETag が変わる");
// 409 のときサーバ状態を返す（ホストが合わせられるように）
r = await call("POST", G("/draw"), { pin: "1234", seq: 1, number: 9 });
check(r.status === 409 && r.data.draws && r.data.draws.length === 2, "409 でもサーバ状態を返す");

/* --- sync（単独モードで溜めた分の一括登録・既出は無視） --- */
r = await call("POST", G("/sync"), { pin: "1234", draws: [{ number: 42 }, { number: 7 }, { number: 13 }, { number: 13 }, { number: 99 }, { number: 51 }] });
check(r.status === 200 && r.data.added === 2, "sync は既出・重複・範囲外を無視して 2 件だけ足す");
check(r.data.draws.map((d) => d.number).join(",") === "42,7,13,51", "履歴の順序が保たれる");
check(r.data.draws.every((d, i) => d.seq === i + 1), "seq が 1 から連番");
check((await call("POST", G("/sync"), { pin: "1234", draws: "x" })).status === 400, "draws が配列でなければ 400");

/* --- undo --- */
r = await call("POST", G("/undo"), { pin: "1234" });
check(r.status === 200 && r.data.draws.map((d) => d.number).join(",") === "42,7,13", "undo は末尾 1 件だけ消す");

/* --- 75 件で finished --- */
const rest = [];
for (let n = 1; n <= 75; n++) rest.push({ number: n });
r = await call("POST", G("/sync"), { pin: "1234", draws: rest });
check(r.data.draws.length === 75 && r.data.game.status === "finished", "75 件で finished");
check(new Set(r.data.draws.map((d) => d.number)).size === 75, "重複ゼロで 75 件");

/* --- reset で空に戻る（version は進み続ける） --- */
const vBefore = r.data.game.version;
r = await call("POST", G("/reset"), { pin: "1234" });
check(r.data.draws.length === 0 && r.data.game.status === "ready", "reset で空・ready");
check(r.data.game.version > vBefore, "reset でも version は進む（客の差分取得が壊れない）");

/* --- 通信断からの復帰シナリオ（単独モードで 20 件 → sync → 続きを draw） --- */
{
  await call("POST", G("/reset"), { pin: "1234" });
  const offline = [];
  const drawn = [];
  for (let i = 0; i < 20; i++) {
    const n = (i * 7 % 75) + 1;                 // 重複しない適当な並び
    if (drawn.includes(n)) continue;
    drawn.push(n);
    offline.push({ number: n, drawn_at: new Date().toISOString() });
  }
  const s = await call("POST", G("/sync"), { pin: "1234", draws: offline });
  check(s.status === 200 && s.data.draws.length === offline.length, "復帰時に未送信分をまとめて送れる");
  const nextSeq = s.data.draws.length + 1;
  const d = await call("POST", G("/draw"), { pin: "1234", seq: nextSeq, number: 74 });
  check(d.status === 200 && d.data.draws.length === nextSeq, "sync の続きから draw が通る（seq が連続）");
  check(d.data.draws[nextSeq - 1].source === "host" && d.data.draws[0].source === "offline-sync",
    "source で単独モード分と通常分を見分けられる");
}

console.log(`[api_test] 判定 ${ok} 件 PASS / ${ng} 件 NG`);
if (ng > 0) { console.error("[api_test] FAIL"); process.exit(1); }
console.log("[api_test] PASS");
