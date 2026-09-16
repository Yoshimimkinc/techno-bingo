/* テクノのビンゴ — Cloudflare Worker（静的アセット配信＋/api）
 *
 * 正本: docs/05_ARCHITECTURE_DESIGN.md（API 表・ER 図・単独モード）
 * パターン: 共通技術台帳 T02 Workers共通実装パターン（W-1 ルーティング／W-5 エラー定型）
 *
 * 設計の芯:
 *   - 番号を決めるのは「ホスト端末」。サーバは検証と配信だけ（通信断でも進行できる設計を壊さない）。
 *   - 1 ゲーム＝KV 1 キー `game:<game_id>`。DRAW は追記のみ、取消は末尾 1 件の削除。
 *   - 書き手はホスト 1 人なので KV の結果整合で足りる（競合しない）。
 *   - 参加者の個人情報は一切持たない（🟢緑）。
 *
 * 静的ファイル（client/public）は wrangler の assets が先に配る。
 * ここに来るのは /api/* と、アセットに無いパスだけ。
 */

const MAX_NUMBER = 75;
const GAME_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      try {
        return await handleApi(request, env, path);
      } catch (err) {
        return json({ ok: false, error: "サーバ側で想定外のエラー: " + (err && err.message) }, 500);
      }
    }

    // アセットに無いパス（/host などは assets 側が host.html を返す）
    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  }
};

/* ============================================================
 * ルーティング
 * ==========================================================*/
async function handleApi(request, env, path) {
  const seg = path.split("/").filter(Boolean);   // ["api","game",":id",action?]
  if (seg[1] !== "game" || !seg[2]) return json({ ok: false, error: "パスが違います" }, 404);

  const gameId = decodeURIComponent(seg[2]);
  if (!GAME_ID_RE.test(gameId)) return json({ ok: false, error: "ゲーム ID が不正です" }, 400);
  if (!env.BINGO) return json({ ok: false, error: "設定エラー: KV 名前空間 BINGO が未設定です" }, 500);

  const action = seg[3] || "";
  const method = request.method.toUpperCase();

  if (!action && method === "GET") return await getState(env, gameId, request);
  if (method !== "POST") return json({ ok: false, error: "メソッドが違います" }, 405);

  const body = await readJson(request);
  if (body === null) return json({ ok: false, error: "本文が JSON ではありません" }, 400);

  switch (action) {
    case "draw": return await postDraw(env, gameId, body);
    case "undo": return await postUndo(env, gameId, body);
    case "reset": return await postReset(env, gameId, body);
    case "sync": return await postSync(env, gameId, body);
    default: return json({ ok: false, error: "そのような操作はありません" }, 404);
  }
}

/* ============================================================
 * KV
 * ==========================================================*/
const key = (id) => "game:" + id;

async function load(env, id) {
  const raw = await env.BINGO.get(key(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function store(env, game) {
  game.version = (game.version || 0) + 1;
  game.updated_at = new Date().toISOString();
  await env.BINGO.put(key(game.game_id), JSON.stringify(game));
  return game;
}

function publicView(game) {
  return {
    ok: true,
    game: {
      game_id: game.game_id,
      title: game.title,
      status: game.status,
      max_number: game.max_number,
      version: game.version,
      created_at: game.created_at,
      updated_at: game.updated_at
    },
    draws: game.draws.map((d) => ({ seq: d.seq, number: d.number, drawn_at: d.drawn_at, source: d.source }))
  };
}

/* ============================================================
 * GET /api/game/:id  （客・ホスト。If-None-Match で 304）
 * ==========================================================*/
async function getState(env, id, request) {
  const game = await load(env, id);
  if (!game) return json({ ok: false, error: "ゲームがまだ始まっていません" }, 404);

  const etag = '"' + game.version + '"';
  const inm = request.headers.get("If-None-Match");
  if (inm && inm.split(",").some((v) => v.trim() === etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-cache" } });
  }
  return json(publicView(game), 200, { ETag: etag });
}

/* ============================================================
 * POST /api/game/:id/draw   {pin, seq, number}
 * ==========================================================*/
async function postDraw(env, id, body) {
  const game = await load(env, id);
  if (!game) return json({ ok: false, error: "ゲームがまだ始まっていません" }, 404);

  const auth = await checkPin(game, body.pin);
  if (auth) return auth;

  const seq = toInt(body.seq), number = toInt(body.number);
  if (!Number.isInteger(number) || number < 1 || number > game.max_number) {
    return json({ ok: false, error: "番号が 1〜" + game.max_number + " の外です" }, 400);
  }
  if (seq !== game.draws.length + 1) {
    return json({ ...publicView(game), ok: false, error: "順番が合いません（サーバは " + game.draws.length + " 件）" }, 409);
  }
  if (game.draws.some((d) => d.number === number)) {
    return json({ ...publicView(game), ok: false, error: "その番号はもう出ています" }, 409);
  }

  game.draws.push({ seq, number, drawn_at: isoOr(body.drawn_at), source: "host" });
  game.status = game.draws.length >= game.max_number ? "finished" : "playing";
  await store(env, game);
  return json(publicView(game), 200, { ETag: '"' + game.version + '"' });
}

/* ============================================================
 * POST /api/game/:id/undo   {pin}
 * ==========================================================*/
async function postUndo(env, id, body) {
  const game = await load(env, id);
  if (!game) return json({ ok: false, error: "ゲームがまだ始まっていません" }, 404);

  const auth = await checkPin(game, body.pin);
  if (auth) return auth;

  game.draws.pop();
  game.status = game.draws.length === 0 ? "ready" : "playing";
  await store(env, game);
  return json(publicView(game), 200, { ETag: '"' + game.version + '"' });
}

/* ============================================================
 * POST /api/game/:id/reset  {pin, title?}
 *   初回はここで PIN（SHA-256）を登録する。既存ゲームがあれば同じ PIN が要る。
 * ==========================================================*/
async function postReset(env, id, body) {
  const pin = String(body.pin == null ? "" : body.pin);
  if (!/^[0-9]{4}$/.test(pin)) return json({ ok: false, error: "PIN は 4 桁の数字です" }, 400);

  const now = new Date().toISOString();
  const old = await load(env, id);
  if (old && old.pin_hash) {
    const auth = await checkPin(old, pin);
    if (auth) return auth;
  }

  const game = {
    game_id: id,
    title: typeof body.title === "string" && body.title ? body.title.slice(0, 40) : "テクノ☆ビンゴ",
    status: "ready",
    max_number: MAX_NUMBER,
    pin_hash: await sha256(pin),
    version: old ? old.version : 0,
    created_at: old ? old.created_at : now,
    updated_at: now,
    draws: []
  };
  await store(env, game);
  return json(publicView(game), 200, { ETag: '"' + game.version + '"' });
}

/* ============================================================
 * POST /api/game/:id/sync   {pin, draws:[{number, drawn_at}]}
 *   単独モードで溜めた履歴の一括登録。既に出ている番号は無視する。
 * ==========================================================*/
async function postSync(env, id, body) {
  const game = await load(env, id);
  if (!game) return json({ ok: false, error: "ゲームがまだ始まっていません" }, 404);

  const auth = await checkPin(game, body.pin);
  if (auth) return auth;

  const list = Array.isArray(body.draws) ? body.draws : null;
  if (!list) return json({ ok: false, error: "draws が配列ではありません" }, 400);
  if (list.length > game.max_number) return json({ ok: false, error: "件数が多すぎます" }, 400);

  const seen = new Set(game.draws.map((d) => d.number));
  let added = 0;
  for (const item of list) {
    const n = toInt(item && item.number);
    if (!Number.isInteger(n) || n < 1 || n > game.max_number) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    game.draws.push({
      seq: game.draws.length + 1, number: n,
      drawn_at: isoOr(item && item.drawn_at), source: "offline-sync"
    });
    added++;
  }
  game.status = game.draws.length >= game.max_number ? "finished"
    : (game.draws.length ? "playing" : "ready");
  await store(env, game);
  const view = publicView(game);
  view.added = added;
  return json(view, 200, { ETag: '"' + game.version + '"' });
}

/* ============================================================
 * 小物
 * ==========================================================*/
async function checkPin(game, pin) {
  const p = String(pin == null ? "" : pin);
  if (!/^[0-9]{4}$/.test(p)) return json({ ok: false, error: "PIN は 4 桁の数字です" }, 401);
  const h = await sha256(p);
  if (h !== game.pin_hash) return json({ ok: false, error: "PIN が違います" }, 401);
  return null;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readJson(request) {
  try { return await request.json(); } catch (e) { return null; }
}

function toInt(v) {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function isoOr(v) {
  if (typeof v === "string" && v.length >= 10 && !Number.isNaN(Date.parse(v))) return v;
  return new Date().toISOString();
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
      ...extra
    }
  });
}
