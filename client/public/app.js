/* テクノ⚡ビンゴ — 共通部（番号プール・保存・APIクライアント・QR生成）
 *
 * 参照: docs/01_PRD.md §3 / docs/05_ARCHITECTURE_DESIGN.md（API・単独モード・ER図）
 * 方針: ビルド無し・素のJS。ホスト端末が番号を決め、サーバは検証と配信だけ。
 *       API が落ちても画面は必ず進む（単独モード）。
 * 区分: 🟢緑（公開アセット。会社名・社員名・個人情報は一切持たない）
 */
(function (root) {
  "use strict";

  var TB = {};

  /* ============================================================
   * 0. 定数
   * ==========================================================*/
  TB.MAX_NUMBER = 75;
  TB.DEFAULT_GAME_ID = "techno-20260930";
  TB.TITLE = "テクノ⚡ビンゴ";
  // PIN は宴会用途では使わない（管理者 2026-09-16 16:45）。
  // サーバ側の検証は互換のため残っているので、クライアントが固定値を自動で送る。
  // 実質のガードは「URL を教えた人しか開けない」こと。
  TB.PIN = "0000";
  TB.LETTERS = ["B", "I", "N", "G", "O"];

  /* ============================================================
   * 1. 番号プール（ER図の「派生（保存しない）」＝残り番号）
   * ==========================================================*/

  /** 未出の番号一覧（昇順）。drawn は既出番号の配列。 */
  TB.remaining = function (drawn, max) {
    max = max || TB.MAX_NUMBER;
    var used = {};
    for (var i = 0; i < (drawn || []).length; i++) used[drawn[i]] = true;
    var out = [];
    for (var n = 1; n <= max; n++) if (!used[n]) out.push(n);
    return out;
  };

  /** 0以上1未満の乱数。crypto があれば使う（無ければ Math.random）。 */
  TB.random = function () {
    try {
      var c = root.crypto || root.msCrypto;
      if (c && c.getRandomValues) {
        var a = new Uint32Array(1);
        c.getRandomValues(a);
        return a[0] / 4294967296;
      }
    } catch (e) { /* 握って Math.random へ */ }
    return Math.random();
  };

  /** 未出から1つ引く。全部出ていたら null。rnd はテスト用に差し替え可。 */
  TB.drawNext = function (drawn, max, rnd) {
    var pool = TB.remaining(drawn, max);
    if (pool.length === 0) return null;
    var r = (rnd || TB.random)();
    var idx = Math.floor(r * pool.length);
    if (idx < 0) idx = 0;
    if (idx >= pool.length) idx = pool.length - 1;
    return pool[idx];
  };

  /** 番号 → B/I/N/G/O */
  TB.letterOf = function (n) {
    if (!n || n < 1) return "";
    var i = Math.floor((n - 1) / 15);
    if (i > 4) i = 4;
    return TB.LETTERS[i];
  };

  /* ============================================================
   * 2. ちいさな道具
   * ==========================================================*/
  TB.qs = function (sel, el) { return (el || document).querySelector(sel); };
  TB.qsa = function (sel, el) {
    return Array.prototype.slice.call((el || document).querySelectorAll(sel));
  };
  TB.pad2 = function (n) { return (n < 10 ? "0" : "") + n; };
  TB.hhmmss = function (d) {
    d = d || new Date();
    return TB.pad2(d.getHours()) + ":" + TB.pad2(d.getMinutes()) + ":" + TB.pad2(d.getSeconds());
  };
  TB.nowIso = function () { return new Date().toISOString(); };

  /** ?g= でゲームIDを上書き（既定 techno-20260930） */
  TB.gameId = function () {
    try {
      var g = new URLSearchParams(root.location.search).get("g");
      if (g && /^[A-Za-z0-9_-]{1,64}$/.test(g)) return g;
    } catch (e) { /* file:// 等 */ }
    return TB.DEFAULT_GAME_ID;
  };

  /** 客用URL（?g= 付き・/host は落とす） */
  TB.guestUrl = function (gid) {
    gid = gid || TB.gameId();
    try {
      var u = new URL(root.location.href);
      u.hash = "";
      u.search = "?g=" + encodeURIComponent(gid);
      u.pathname = u.pathname.replace(/host(\.html)?$/i, "").replace(/\/+$/, "") + "/";
      if (u.protocol === "file:") return u.href.replace(/host\.html/i, "index.html");
      return u.href;
    } catch (e) {
      return "?g=" + gid;
    }
  };

  /* ============================================================
   * 3. 保存（localStorage が無い／弾かれる環境でもメモリで動く）
   * ==========================================================*/
  var memStore = {};
  TB.store = {
    get: function (key) {
      try {
        var v = root.localStorage.getItem(key);
        if (v != null) return JSON.parse(v);
      } catch (e) { /* file:// / プライベートモード */ }
      return memStore[key] != null ? memStore[key] : null;
    },
    set: function (key, val) {
      memStore[key] = val;
      try { root.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 続行 */ }
    },
    del: function (key) {
      delete memStore[key];
      try { root.localStorage.removeItem(key); } catch (e) { /* 続行 */ }
    }
  };

  /* ============================================================
   * 4. APIクライアント（絶対に throw しない）
   *    file:// では通信そのものを行わない＝単独モード
   * ==========================================================*/
  TB.apiEnabled = (function () {
    try { return root.location.protocol === "http:" || root.location.protocol === "https:"; }
    catch (e) { return false; }
  })();

  function apiCall(method, path, body, headers) {
    if (!TB.apiEnabled) {
      return Promise.resolve({ ok: false, offline: true, status: 0, data: null, etag: null });
    }
    var opt = { method: method, headers: headers || {}, cache: "no-store" };
    if (body !== undefined && body !== null) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    return fetch(path, opt).then(function (res) {
      var etag = res.headers.get("ETag");
      if (res.status === 304) return { ok: true, status: 304, data: null, etag: etag, offline: false };
      return res.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        return { ok: res.ok, status: res.status, data: data, etag: etag, offline: false };
      });
    })["catch"](function () {
      return { ok: false, offline: true, status: 0, data: null, etag: null };
    });
  }
  TB.apiCall = apiCall;

  TB.api = {
    state: function (gid, etag) {
      var h = {};
      if (etag) h["If-None-Match"] = etag;
      return apiCall("GET", "/api/game/" + encodeURIComponent(gid), null, h);
    },
    draw: function (gid, pin, seq, number) {
      return apiCall("POST", "/api/game/" + encodeURIComponent(gid) + "/draw",
        { pin: pin, seq: seq, number: number });
    },
    undo: function (gid, pin) {
      return apiCall("POST", "/api/game/" + encodeURIComponent(gid) + "/undo", { pin: pin });
    },
    reset: function (gid, pin, title) {
      return apiCall("POST", "/api/game/" + encodeURIComponent(gid) + "/reset",
        { pin: pin, title: title || TB.TITLE });
    },
    sync: function (gid, pin, draws) {
      return apiCall("POST", "/api/game/" + encodeURIComponent(gid) + "/sync",
        { pin: pin, draws: draws });
    }
  };

  /* ============================================================
   * 5. でか文字：画面幅いっぱいに合わせる
   *    CSS の min(vw, vh) を基本にし、桁数で微調整する。
   * ==========================================================*/
  /** mode: 既定＝スマホ（画面幅いっぱい）／"projector"＝左 40% の欄に収める */
  TB.fitBig = function (el, text, mode) {
    if (!el) return;
    el.textContent = text;
    var len = String(text == null ? "" : text).length;
    var t;
    if (mode === "projector") {
      t = len <= 1 ? [24, 52] : len === 2 ? [28, 50] : len <= 4 ? [14, 26] : [8, 16];
    } else {
      t = len <= 1 ? [62, 32] : len === 2 ? [75, 32] : len <= 4 ? [34, 18] : [20, 16];
    }
    el.style.fontSize = "min(" + t[0] + "vw, " + t[1] + "vh)";
  };

  /* ============================================================
   * 5-2. 盤面（プロジェクター表示用）
   *   B/I/N/G/O の 5 行 × 15 列。ER 図の「派生（保存しない）」にあたる。
   * ==========================================================*/
  TB.boardRows = function (drawn, max) {
    max = max || TB.MAX_NUMBER;
    var per = Math.ceil(max / TB.LETTERS.length);       // 15
    var hit = {}, i;
    for (i = 0; i < (drawn || []).length; i++) hit[drawn[i]] = true;
    var latest = (drawn && drawn.length) ? drawn[drawn.length - 1] : null;
    var rows = [];
    for (var r = 0; r < TB.LETTERS.length; r++) {
      var cells = [];
      for (var c = 0; c < per; c++) {
        var n = r * per + c + 1;
        if (n > max) break;
        cells.push({ number: n, hit: !!hit[n], latest: n === latest });
      }
      rows.push({ letter: TB.LETTERS[r], cells: cells });
    }
    return rows;
  };

  /* ============================================================
   * 6. QRコード生成（外部ライブラリ無し・byteモード／誤り訂正 M／型番1〜10）
   *    会場が圏外でも QR を出せるように自前で持つ。
   * ==========================================================*/
  var QR = (function () {
    /* --- GF(256) --- */
    var EXP = new Array(512), LOG = new Array(256);
    (function () {
      var x = 1;
      for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
      for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
    })();
    function gmul(a, b) { if (a === 0 || b === 0) return 0; return EXP[LOG[a] + LOG[b]]; }
    function polyMul(a, b) {
      var r = new Array(a.length + b.length - 1);
      for (var i = 0; i < r.length; i++) r[i] = 0;
      for (var p = 0; p < a.length; p++) for (var q = 0; q < b.length; q++) r[p + q] ^= gmul(a[p], b[q]);
      return r;
    }
    function genPoly(n) { var g = [1]; for (var i = 0; i < n; i++) g = polyMul(g, [1, EXP[i]]); return g; }
    function rsEncode(data, ecLen) {
      var gen = genPoly(ecLen), res = data.slice();
      for (var z = 0; z < ecLen; z++) res.push(0);
      for (var i = 0; i < data.length; i++) {
        var coef = res[i];
        if (coef !== 0) for (var j = 1; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
      }
      return res.slice(data.length);
    }

    /* --- 型番テーブル（誤り訂正 M のみ） ---
       [ECコード語/ブロック, 群1ブロック数, 群1データ語, 群2ブロック数, 群2データ語] */
    var RS = {
      1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0],
      4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0],
      7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37],
      10: [26, 4, 43, 1, 44]
    };
    var ALIGN = {
      1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
      6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
    };
    function dataCodewords(v) { var r = RS[v]; return r[1] * r[2] + r[3] * r[4]; }
    function capacityBytes(v) { return dataCodewords(v) - (v < 10 ? 2 : 3); }

    /* --- BCH --- */
    function bitLen(n) { var c = 0; while (n !== 0) { c++; n >>>= 1; } return c; }
    function bchFormat(data5) {
      var d = data5 << 10;
      while (bitLen(d) - bitLen(0x537) >= 0) d ^= (0x537 << (bitLen(d) - bitLen(0x537)));
      return (((data5 << 10) | d) ^ 0x5412) & 0x7fff;
    }
    function bchVersion(ver) {
      var d = ver << 12;
      while (bitLen(d) - bitLen(0x1f25) >= 0) d ^= (0x1f25 << (bitLen(d) - bitLen(0x1f25)));
      return ((ver << 12) | d) & 0x3ffff;
    }

    /* --- UTF-8 --- */
    function toBytes(str) {
      var out = [];
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
          var c2 = str.charCodeAt(++i);
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
      }
      return out;
    }

    /* --- マスク --- */
    var MASKS = [
      function (i, j) { return (i + j) % 2 === 0; },
      function (i) { return i % 2 === 0; },
      function (i, j) { return j % 3 === 0; },
      function (i, j) { return (i + j) % 3 === 0; },
      function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
      function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
      function (i, j) { return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0; },
      function (i, j) { return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0; }
    ];

    function newGrid(size, fill) {
      var m = new Array(size);
      for (var i = 0; i < size; i++) { m[i] = new Array(size); for (var j = 0; j < size; j++) m[i][j] = fill; }
      return m;
    }

    function setupBase(mod, res, size, version) {
      function box(r, c) {
        for (var i = -1; i <= 7; i++) for (var j = -1; j <= 7; j++) {
          var rr = r + i, cc = c + j;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          var on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                   (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                   (i >= 2 && i <= 4 && j >= 2 && j <= 4);
          mod[rr][cc] = on; res[rr][cc] = true;
        }
      }
      box(0, 0); box(0, size - 7); box(size - 7, 0);
      // タイミングパターン
      for (var k = 8; k < size - 8; k++) {
        mod[6][k] = (k % 2 === 0); res[6][k] = true;
        mod[k][6] = (k % 2 === 0); res[k][6] = true;
      }
      // 位置合わせパターン
      var pos = ALIGN[version], last = pos.length - 1;
      for (var a = 0; a < pos.length; a++) for (var b = 0; b < pos.length; b++) {
        // 切り出しパターン（3隅）と重なる位置には置かない
        if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
        var r = pos[a], c = pos[b];
        for (var i2 = -2; i2 <= 2; i2++) for (var j2 = -2; j2 <= 2; j2++) {
          var on2 = Math.max(Math.abs(i2), Math.abs(j2)) !== 1;
          mod[r + i2][c + j2] = on2; res[r + i2][c + j2] = true;
        }
      }
      // 形式情報の予約
      for (var f = 0; f < 9; f++) {
        if (!res[8][f]) { res[8][f] = true; mod[8][f] = false; }
        if (!res[f][8]) { res[f][8] = true; mod[f][8] = false; }
      }
      for (var g = 0; g < 8; g++) {
        res[8][size - 1 - g] = true; mod[8][size - 1 - g] = false;
        res[size - 1 - g][8] = true; mod[size - 1 - g][8] = false;
      }
      mod[size - 8][8] = true; res[size - 8][8] = true; // 常に黒のモジュール
      // 型番情報の予約（型番7以上）
      if (version >= 7) {
        for (var v = 0; v < 18; v++) {
          var rr2 = Math.floor(v / 3), cc2 = (v % 3) + size - 8 - 3;
          res[rr2][cc2] = true; mod[rr2][cc2] = false;
          res[cc2][rr2] = true; mod[cc2][rr2] = false;
        }
      }
    }

    function placeFormat(mod, size, fmt) {
      for (var i = 0; i < 15; i++) {
        var bit = ((fmt >> i) & 1) === 1;
        if (i < 6) mod[i][8] = bit;
        else if (i < 8) mod[i + 1][8] = bit;
        else mod[size - 15 + i][8] = bit;
      }
      for (var j = 0; j < 15; j++) {
        var b2 = ((fmt >> j) & 1) === 1;
        if (j < 8) mod[8][size - j - 1] = b2;
        else if (j < 9) mod[8][15 - j] = b2;
        else mod[8][15 - j - 1] = b2;
      }
      mod[size - 8][8] = true;
    }

    function placeVersion(mod, size, version) {
      if (version < 7) return;
      var bits = bchVersion(version);
      for (var i = 0; i < 18; i++) {
        var bit = ((bits >> i) & 1) === 1;
        var r = Math.floor(i / 3), c = (i % 3) + size - 8 - 3;
        mod[r][c] = bit; mod[c][r] = bit;
      }
    }

    /** データビットをジグザグに配置（読み出しも同じ順序でたどる） */
    function dataPath(res, size) {
      var path = [], dir = -1, row = size - 1;
      for (var col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        for (;;) {
          for (var c = 0; c < 2; c++) {
            var cc = col - c;
            if (!res[row][cc]) path.push([row, cc]);
          }
          row += dir;
          if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
        }
      }
      return path;
    }

    function penalty(mod, size) {
      var p = 0, i, j, k, run, dark = 0;
      // 規則1: 同色5連以上
      for (i = 0; i < size; i++) {
        run = 1;
        for (j = 1; j < size; j++) {
          if (mod[i][j] === mod[i][j - 1]) run++; else { if (run >= 5) p += 3 + (run - 5); run = 1; }
        }
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
        for (k = 1; k < size; k++) {
          if (mod[k][i] === mod[k - 1][i]) run++; else { if (run >= 5) p += 3 + (run - 5); run = 1; }
        }
        if (run >= 5) p += 3 + (run - 5);
      }
      // 規則2: 2x2 同色
      for (i = 0; i < size - 1; i++) for (j = 0; j < size - 1; j++) {
        var v = mod[i][j];
        if (v === mod[i][j + 1] && v === mod[i + 1][j] && v === mod[i + 1][j + 1]) p += 3;
      }
      // 規則3: 1011101 + 空白4
      var pat1 = [true, false, true, true, true, false, true, false, false, false, false];
      var pat2 = [false, false, false, false, true, false, true, true, true, false, true];
      function match(get, n) {
        var hit = 0;
        for (var s = 0; s + 11 <= n; s++) {
          var ok1 = true, ok2 = true;
          for (var t = 0; t < 11; t++) {
            var vv = get(s + t);
            if (vv !== pat1[t]) ok1 = false;
            if (vv !== pat2[t]) ok2 = false;
          }
          if (ok1) hit++;
          if (ok2) hit++;
        }
        return hit;
      }
      for (i = 0; i < size; i++) {
        (function (r) { p += 40 * match(function (x) { return mod[r][x]; }, size); })(i);
        (function (c) { p += 40 * match(function (x) { return mod[x][c]; }, size); })(i);
      }
      // 規則4: 黒の比率
      for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (mod[i][j]) dark++;
      var ratio = (dark * 100) / (size * size);
      p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
      return p;
    }

    /** text → {size, modules, version, mask} （modules[row][col] = true が黒） */
    function encode(text) {
      var bytes = toBytes(String(text));
      var version = 0;
      for (var v = 1; v <= 10; v++) { if (bytes.length <= capacityBytes(v)) { version = v; break; } }
      if (!version) throw new Error("QR: 文字数が多すぎます（" + bytes.length + " バイト）");

      var dcw = dataCodewords(version), bits = [];
      function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
      push(4, 4);                                   // byteモード
      push(bytes.length, version < 10 ? 8 : 16);
      for (var b = 0; b < bytes.length; b++) push(bytes[b], 8);
      var total = dcw * 8;
      for (var t = 0; t < 4 && bits.length < total; t++) bits.push(0);
      while (bits.length % 8 !== 0) bits.push(0);
      var padByte = 0xec;
      while (bits.length < total) { push(padByte, 8); padByte = (padByte === 0xec) ? 0x11 : 0xec; }

      var cws = [];
      for (var c = 0; c < bits.length; c += 8) {
        var byte = 0;
        for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[c + k];
        cws.push(byte);
      }

      // ブロック分割 → RS → インターリーブ
      var r = RS[version], ecLen = r[0];
      var blocks = [], p = 0, i;
      for (i = 0; i < r[1]; i++) { blocks.push(cws.slice(p, p + r[2])); p += r[2]; }
      for (i = 0; i < r[3]; i++) { blocks.push(cws.slice(p, p + r[4])); p += r[4]; }
      var ecs = blocks.map(function (bl) { return rsEncode(bl, ecLen); });
      var maxData = Math.max(r[2], r[4] || 0), seq = [];
      for (i = 0; i < maxData; i++) for (var j = 0; j < blocks.length; j++) if (i < blocks[j].length) seq.push(blocks[j][i]);
      for (i = 0; i < ecLen; i++) for (var j2 = 0; j2 < ecs.length; j2++) seq.push(ecs[j2][i]);

      var finalBits = [];
      for (i = 0; i < seq.length; i++) for (var q = 7; q >= 0; q--) finalBits.push((seq[i] >> q) & 1);

      var size = version * 4 + 17;
      var res = newGrid(size, false), base = newGrid(size, false);
      setupBase(base, res, size, version);
      var path = dataPath(res, size);

      var best = null;
      for (var mk = 0; mk < 8; mk++) {
        var mod = base.map(function (row) { return row.slice(); });
        for (i = 0; i < path.length; i++) {
          var rr = path[i][0], cc = path[i][1];
          var bit = i < finalBits.length ? finalBits[i] === 1 : false;
          mod[rr][cc] = MASKS[mk](rr, cc) ? !bit : bit;
        }
        placeFormat(mod, size, bchFormat((0 << 3) | mk)); // 誤り訂正M = 0b00
        placeVersion(mod, size, version);
        var sc = penalty(mod, size);
        if (!best || sc < best.score) best = { score: sc, modules: mod, mask: mk };
      }
      return {
        size: size, modules: best.modules, version: version, mask: best.mask,
        reserved: res, path: path, codewords: seq, ecLen: ecLen, rs: r
      };
    }

    /** canvas に描く（余白4モジュール） */
    function draw(canvas, text, opt) {
      opt = opt || {};
      var qr = encode(text);
      var quiet = opt.quiet == null ? 4 : opt.quiet;
      var n = qr.size + quiet * 2;
      var css = opt.px || Math.min(canvas.clientWidth || 280, 480);
      var dpr = root.devicePixelRatio || 1;
      var scale = Math.max(1, Math.floor((css * dpr) / n));
      var px = n * scale;
      canvas.width = px; canvas.height = px;
      canvas.style.width = css + "px"; canvas.style.height = css + "px";
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = opt.light || "#ffffff";
      ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = opt.dark || "#000000";
      for (var i = 0; i < qr.size; i++) for (var j = 0; j < qr.size; j++) {
        if (qr.modules[i][j]) ctx.fillRect((j + quiet) * scale, (i + quiet) * scale, scale, scale);
      }
      return qr;
    }

    return { encode: encode, draw: draw, capacityBytes: capacityBytes, dataCodewords: dataCodewords, bchFormat: bchFormat, bchVersion: bchVersion };
  })();
  TB.qr = QR;

  /* ============================================================
   * 7. 誤操作抑止（W-14）
   * ==========================================================*/
  TB.guardGestures = function () {
    try {
      // ピンチ拡大（iOS Safari）
      document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
      document.addEventListener("gesturechange", function (e) { e.preventDefault(); });
      // ダブルクリック拡大
      document.addEventListener("dblclick", function (e) { e.preventDefault(); }, { passive: false });
      // iOS の古い挙動：300ms 以内の 2 回目のタップを止める（拡大だけを殺し、スクロールは残す）
      var lastTap = 0;
      document.addEventListener("touchend", function (e) {
        var now = Date.now();
        if (now - lastTap <= 300 && e.touches.length === 0) e.preventDefault();
        lastTap = now;
      }, { passive: false });
      // 2 本指以上のタッチ（ピンチ）そのものを止める
      document.addEventListener("touchmove", function (e) {
        if (e.touches && e.touches.length > 1) e.preventDefault();
      }, { passive: false });
    } catch (e) { /* 続行 */ }
  };


  /* ============================================================
   * 8. ドラム（Web Audio で合成・音源ファイル無し）
   *    履歴カード／チップを押した時に鳴らす。押した本人だけに聞こえる音なので
   *    トグルは付けない（既定 ON）。※iPhone はマナーモードだと鳴らない。
   *    AudioContext は最初のタップで作る（自動再生制限に掛からない）。
   *    連打しても詰まらないよう、毎回ノードを作って鳴り終わりに捨てる。
   * ==========================================================*/
  var actx = null, noiseBuf = null;

  function audio() {
    try {
      if (!actx) {
        var C = root.AudioContext || root.webkitAudioContext;
        if (!C) return null;
        actx = new C();
      }
      if (actx.state === "suspended" && actx.resume) actx.resume();
      return actx;
    } catch (e) { return null; }
  }

  function noise(ctx) {
    if (noiseBuf) return noiseBuf;
    var n = Math.floor(ctx.sampleRate * 0.2);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /** ドン（キック）＋タン（スネア）を同時に鳴らす。全部で 0.2 秒ほど。 */
  TB.drum = function () {
    var ctx = audio();
    if (!ctx) return;
    // 止まっていたら再開してから鳴らす（最初の 1 回が無音にならないように）
    if (ctx.state === "suspended" && ctx.resume) {
      try { ctx.resume().then(function () { fire(ctx); }, function () { fire(ctx); }); return; }
      catch (e) { /* 下でそのまま鳴らす */ }
    }
    fire(ctx);
  };

  function fire(ctx) {
    try {
      var t = ctx.currentTime;

      // キック：150Hz → 40Hz へ 0.15 秒で下げる。波形は square 寄りでファミコン感を出す
      var osc = ctx.createOscillator(), og = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      og.gain.setValueAtTime(0.38, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(og).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.2);

      // スネア風：ホワイトノイズをバンドパスして 0.12 秒で切る
      var src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
      src.buffer = noise(ctx);
      bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
      ng.gain.setValueAtTime(0.22, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      src.connect(bp).connect(ng).connect(ctx.destination);
      src.start(t); src.stop(t + 0.14);

      // 鳴り終わったら捨てる（連打しても溜まらない）
      var kill = function () { try { osc.disconnect(); og.disconnect(); src.disconnect(); bp.disconnect(); ng.disconnect(); } catch (e) { } };
      osc.onended = kill; src.onended = kill;
    } catch (e) { /* 鳴らなくても画面は進む */ }
  }

  /** 履歴カード／チップのタップ：ドラム＋一瞬光る＋軽いバイブ */
  TB.hitFeedback = function (el2) {
    TB.drum();
    if (el2) {
      el2.classList.remove("tap");
      void el2.offsetWidth;
      el2.classList.add("tap");
      setTimeout(function () { el2.classList.remove("tap"); }, 300);
    }
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { }
  };

  /** 親要素に 1 つだけリスナーを付けて、中のカードのタップを拾う（委譲） */
  TB.bindDrum = function (container, selector) {
    if (!container) return;
    container.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (t && container.contains(t)) TB.hitFeedback(t);
    });
  };


  /* ============================================================
   * 9. 確定の演出（v07・ホストと参加者で共通のエンジン）
   *    ①暗転→ネオン 3 拍の光＋画面ゆれ＋ネオングリッド
   *    ②でか文字が 2.2 倍から 1 回跳ねて着地・4 層グローが 2 回脈打つ
   *    ③紙吹雪＋星＋スパーク ④バイブ 3 連 ⑤見出しの揺れ
   *    合計 1.6 秒。最後の 0.4 秒で必ず読める状態に落ち着く。
   *    時間基準で描くので、コマ落ちしても必ず 1.6 秒で終わる。
   * ==========================================================*/
  TB.FX_SHOW_MS = 1600;          // 演出全体
  TB.FX_PARTICLE_MS = 1500;      // 粒子の寿命

  var fxRaf = null, fxCanvas = null, fxKill = null, fxEnd = null, fxCfg = null;

  TB.reducedMotion = function () {
    try { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  };

  /** 端末性能で粒子数を決める（既定は上限いっぱい・非力な端末だけ半分） */
  TB.particleCount = function (max) {
    var n = max || 120;
    try {
      var cores = navigator.hardwareConcurrency || 8;
      var dpr = root.devicePixelRatio || 1;
      if (cores <= 4 || dpr >= 3) n = Math.round(n / 2);
    } catch (e) { /* 分からなければ既定のまま */ }
    return n;
  };

  function offClass(el, c) { if (el) el.classList.remove(c); }

  /** 走っている演出を完全に止めて後片付けする（連続で来ても重ならない） */
  TB.stopFx = function () {
    if (fxRaf) { cancelAnimationFrame(fxRaf); fxRaf = null; }
    if (fxKill) { clearTimeout(fxKill); fxKill = null; }
    if (fxEnd) { clearTimeout(fxEnd); fxEnd = null; }
    if (fxCanvas && fxCanvas.parentNode) fxCanvas.parentNode.removeChild(fxCanvas);
    fxCanvas = null;
    var c = fxCfg; fxCfg = null;
    if (c) {
      offClass(c.big, "mega"); offClass(c.flash, "on"); offClass(c.neongrid, "on");
      offClass(c.shake, "quake"); offClass(c.shock, "on"); offClass(c.logo, "quake2");
      if (c.onEnd) { try { c.onEnd(); } catch (e) { /* 呼び出し側の都合は握る */ } }
    }
  };

  /**
   * 演出を出す。cfg に渡した要素だけが動く（渡さなければその演出は出ない）。
   *   big/flash/neongrid/shake/shock/logo … 対象の要素
   *   count      … 粒子の上限（既定 120。プロジェクターは 160 まで）
   *   area()     … 粒子を降らせる範囲 {x,y,w,h}（既定＝画面全体）
   *   origin()   … 粒子の湧き出し位置 {x,y}（既定＝area の中央）
   *   onEnd()    … 終了時に必ず呼ばれる（ボタンを戻すのに使う）
   */
  TB.showFx = function (cfg) {
    TB.stopFx();
    cfg = cfg || {};
    fxCfg = cfg;

    if (cfg.big) {
      cfg.big.classList.remove("mega");
      void cfg.big.offsetWidth;                   // 直前の演出を確実に打ち切る
      cfg.big.classList.add("mega");
    }
    if (TB.reducedMotion()) {                     // 動きを減らす設定＝拡大と色だけ
      fxEnd = setTimeout(TB.stopFx, 420);
      return;
    }
    if (cfg.flash) cfg.flash.classList.add("on");
    if (cfg.neongrid) cfg.neongrid.classList.add("on");
    if (cfg.shake) cfg.shake.classList.add("quake");
    if (cfg.shock) cfg.shock.classList.add("on");
    if (cfg.logo) cfg.logo.classList.add("quake2");

    confetti(cfg);
    try { if (navigator.vibrate) navigator.vibrate(cfg.vibrate || [60, 40, 60, 40, 120]); }
    catch (e) { /* 非対応端末は無視 */ }

    fxEnd = setTimeout(TB.stopFx, TB.FX_SHOW_MS);  // 何があっても 1.6 秒で戻す
  };

  /* 紙吹雪＋星＋スパーク。canvas はここで作り、終わったら DOM から外す。 */
  function confetti(cfg) {
    var area = cfg.area ? cfg.area()
      : { x: 0, y: 0, w: root.innerWidth, h: root.innerHeight };
    if (!area || area.w < 40 || area.h < 40) return;

    var cv = document.createElement("canvas");
    cv.className = "fx";
    cv.setAttribute("aria-hidden", "true");
    cv.style.left = area.x + "px"; cv.style.top = area.y + "px";
    cv.style.width = area.w + "px"; cv.style.height = area.h + "px";
    document.body.appendChild(cv);
    fxCanvas = cv;

    // 粒子に解像度は要らない。1.5 で頭打ちにして塗る面積を減らす（低スペック対策）
    var dpr = Math.min(root.devicePixelRatio || 1, 1.5);
    cv.width = Math.round(area.w * dpr);
    cv.height = Math.round(area.h * dpr);
    var ctx = cv.getContext("2d");
    if (!ctx) { TB.stopFx(); return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var o = cfg.origin ? cfg.origin() : null;
    var cx = o ? o.x - area.x : area.w / 2;
    var cy = o ? o.y - area.y : area.h * 0.4;

    var N = TB.particleCount(cfg.count || 120);
    var COL = ["#ffd60a", "#ffffff", "#00e5ff", "#ff2bd6", "#ff7a18"];
    var ps = [], i;
    for (i = 0; i < N; i++) {
      var a = (Math.PI * 2 * i) / N + Math.random() * 0.5;
      var sp = 3.2 + Math.random() * 6.5;
      ps.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.4,
        w: 4 + Math.random() * 6, h: 7 + Math.random() * 9,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        c: COL[i % COL.length], k: i % 3          // 0=紙吹雪 1=星 2=スパーク
      });
    }

    function clearAll() {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore();
    }
    function star(x, y, rad) {
      ctx.beginPath();
      for (var j = 0; j < 5; j++) {
        var ang = (Math.PI * 2 * j) / 5 - Math.PI / 2;
        ctx.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
        ctx.lineTo(x + Math.cos(ang + Math.PI / 5) * rad * .45, y + Math.sin(ang + Math.PI / 5) * rad * .45);
      }
      ctx.closePath(); ctx.fill();
    }

    // 画面を裏に回されて rAF が止まっても、実時間で必ず消す
    fxKill = setTimeout(function () {
      if (fxRaf) { cancelAnimationFrame(fxRaf); fxRaf = null; }
      if (cv.parentNode) cv.parentNode.removeChild(cv);
      if (fxCanvas === cv) fxCanvas = null;
    }, TB.FX_PARTICLE_MS + 120);

    var LIFE = TB.FX_PARTICLE_MS, t0 = Date.now(), prev = t0;
    (function frame() {
      var now = Date.now(), t = now - t0;
      var dt = Math.min((now - prev) / 16.67, 3);   // 経過時間で進める（コマ落ちに強い）
      prev = now;
      if (t >= LIFE) {
        clearAll();
        if (cv.parentNode) cv.parentNode.removeChild(cv);
        if (fxCanvas === cv) fxCanvas = null;
        fxRaf = null;
        return;
      }
      clearAll();
      var fade = Math.max(0, 1 - t / LIFE);
      ctx.globalCompositeOperation = "lighter";     // 重なるほど光る
      for (var i2 = 0; i2 < ps.length; i2++) {
        var p = ps[i2];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.17 * dt;
        p.vx *= Math.pow(0.99, dt); p.rot += p.vr * dt;
        ctx.fillStyle = p.c; ctx.strokeStyle = p.c;
        if (p.k === 0) {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.globalAlpha = fade * .38;             // にじみ（グローの代わり・影ぼかしは重い）
          ctx.fillRect(-p.w * .95, -p.h * .8, p.w * 1.9, p.h * 1.6);
          ctx.globalAlpha = fade;                   // 芯
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        } else if (p.k === 1) {
          ctx.globalAlpha = fade * .38; star(p.x, p.y, p.w * 1.7);
          ctx.globalAlpha = fade; star(p.x, p.y, p.w * .9);
        } else {
          ctx.globalAlpha = fade * .4; ctx.lineWidth = 6; ctx.beginPath();
          ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4); ctx.stroke();
          ctx.globalAlpha = fade; ctx.lineWidth = 2.2; ctx.beginPath();
          ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      fxRaf = requestAnimationFrame(frame);
    })();
  }

  /** 要素の中心（粒子の湧き出し位置に使う） */
  TB.centerOf = function (el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  if (typeof module !== "undefined" && module.exports) module.exports = TB;
  root.TB = TB;
})(typeof window !== "undefined" ? window : globalThis);
