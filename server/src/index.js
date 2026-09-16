/* テクノ⚡ビンゴ — Cloudflare Worker（静的アセット配信＋/api）
 *
 * 正本: docs/05_ARCHITECTURE_DESIGN.md（API 表・ER 図・単独モード）
 * パターン: 共通技術台帳 T02 Workers共通実装パターン（W-1 ルーティング／W-5 エラー定型）
 *
 * 設計の芯:
 *   - 番号を決めるのは「ホスト端末」。サーバは検証と配信だけ（通信断でも進行できる設計を壊さない）。
 *   - **状態は Durable Object（ゲーム ID ごとに 1 個）に置く＝強整合。**
 *     v04 までは KV だったが、KV は結果整合で、書いた colo 以外では最大 60 秒古い値が返る。
 *     ホストと同じ Wi-Fi の PC は即追従するのに、4G/5G の携帯（別 colo）だけ遅れる現象が実機で出た。
 *     DO はゲームごとに 1 インスタンスしか無いので、どの colo から読んでも必ず最新になる。
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
        const seg = path.split("/").filter(Boolean);        // ["api","game",":id",action?]
        if (seg[1] !== "game" || !seg[2]) return json({ ok: false, error: "パスが違います" }, 404);

        const gameId = decodeURIComponent(seg[2]);
        if (!GAME_ID_RE.test(gameId)) return json({ ok: false, error: "ゲーム ID が不正です" }, 400);
        if (!env.GAME) {
          return json({ ok: false, error: "設定エラー: Durable Object バインディング GAME が未設定です" }, 500);
        }
        // ゲーム ID ＝ DO の名前。世界のどこから来ても同じ 1 インスタンスに届く（＝強整合）
        const stub = env.GAME.get(env.GAME.idFromName(gameId));
        return await stub.fetch(request);
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
 * Durable Object：1 ゲーム＝1 インスタンス
 *   DRAW は追記のみ、取消は末尾 1 件の削除（ER 図のとおり）。
 *   保存先が KV から DO のストレージに変わっただけで、データの形も API も同じ。
 * ==========================================================*/
export class BingoGame {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.game = null;        // メモリ上のキャッシュ
    this.loaded = false;
    this.tail = Promise.resolve();
  }

  /** 書き込みが交差しないよう、1 件ずつ順番に処理する */
  fetch(request) {
    const run = () => this.handle(request);
    this.tail = this.tail.then(run, run);
    return this.tail;
  }

  async load() {
    if (!this.loaded) {
      this.game = (await this.state.storage.get("game")) || null;
      this.loaded = true;
    }
    return this.game;
  }

  async save(game) {
    game.version = (game.version || 0) + 1;
    game.updated_at = new Date().toISOString();
    await this.state.storage.put("game", game);
    this.game = game;
    this.loaded = true;
    return game;
  }

  async handle(request) {
    const url = new URL(request.url);
    const seg = url.pathname.split("/").filter(Boolean);
    const gameId = decodeURIComponent(seg[2]);
    const action = seg[3] || "";
    const method = request.method.toUpperCase();

    if (!action && method === "GET") return this.getState(request);
    if (method !== "POST") return json({ ok: false, error: "メソッドが違います" }, 405);

    const body = await readJson(request);
    if (body === null) return json({ ok: false, error: "本文が JSON ではありません" }, 400);

    switch (action) {
      case "draw": return this.postDraw(body);
      case "undo": return this.postUndo(body);
      case "reset": return this.postReset(gameId, body);
      case "sync": return this.postSync(body);
      default: return json({ ok: false, error: "そのような操作はありません" }, 404);
    }
  }

  /* --- GET /api/game/:id （客・ホスト。If-None-Match で 304） --- */
  async getState(request) {
    const game = await this.load();
    if (!game) return json({ ok: false, error: "ゲームがまだ始まっていません" }, 404);

    const etag = '"' + game.version + '"';
    const inm = request.headers.get("If-None-Match");
    if (inm && inm.split(",").some((v) => v.trim() === etag)) {
      return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
    }
    return json(publicView(game), 200, { ETag: etag });
  }

  /* --- POST draw {pin, seq, number} --- */
  async postDraw(body) {
    const game = await this.load();
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
    await this.save(game);
    return json(publicView(game), 200, { ETag: '"' + game.version + '"' });
  }

  /* --- POST undo {pin} --- */
  async postUndo(body) {
    const game = await this.load();
    if (!game) return json({ ok: false, error: "ゲームがまだ始まっていません" }, 404);

    const auth = await checkPin(game, body.pin);
    if (auth) return auth;

    game.draws.pop();
    game.status = game.draws.length === 0 ? "ready" : "playing";
    await this.save(game);
    return json(publicView(game), 200, { ETag: '"' + game.version + '"' });
  }

  /* --- POST reset {pin, title?}：ここで PIN（SHA-256）を登録し直す ---
     PIN は v07 で内部固定になった（宴会用途では使わない）。実質のガードは URL の秘匿。
     古い PIN との一致は求めない＝別の PIN で作られた古いゲームがあっても、
     ホストが「新しいゲーム」を押せば必ず取り戻せる（当日に詰まらないことを優先）。 */
  async postReset(gameId, body) {
    const pin = String(body.pin == null ? "" : body.pin);
    if (!/^[0-9]{4}$/.test(pin)) return json({ ok: false, error: "PIN は 4 桁の数字です" }, 400);

    const now = new Date().toISOString();
    const old = await this.load();

    const game = {
      game_id: gameId,
      title: typeof body.title === "string" && body.title ? body.title.slice(0, 40) : "テクノ⚡ビンゴ",
      status: "ready",
      max_number: MAX_NUMBER,
      pin_hash: await sha256(pin),
      version: old ? old.version : 0,
      created_at: old ? old.created_at : now,
      updated_at: now,
      draws: []
    };
    await this.save(game);
    return json(publicView(game), 200, { ETag: '"' + game.version + '"' });
  }

  /* --- POST sync {pin, draws:[...]}：単独モードで溜めた履歴の一括登録 --- */
  async postSync(body) {
    const game = await this.load();
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
    await this.save(game);
    const view = publicView(game);
    view.added = added;
    return json(view, 200, { ETag: '"' + game.version + '"' });
  }
}

/* ============================================================
 * 小物
 * ==========================================================*/
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
      // 携帯ブラウザの HTTP キャッシュに拾わせない（追従が遅れる原因になる）
      "Cache-Control": "no-store",
      ...extra
    }
  });
}
