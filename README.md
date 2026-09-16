# テクノ⚡ビンゴ

2026-09-30 テクノ協同組合 懇親会のビンゴを、ホワイトボードもビンゴ機も無い会場でスマホだけで回すアプリ。

- ホスト（進行役）のスマホ＝ビンゴ機（`/host`・PIN あり）
- 参加者のスマホ＝ホワイトボード（`/`・QR から開く・見るだけ・自動更新）

開発方針（2026-09-16 管理者決定）＝㋑ミニマムスタート型。1 回のイベント用に最小で作り、当日に止まらないこと（通信断でもホスト単体で進行できる）を最優先にする。

## 構成
```
テクノのビンゴ/
├── docs/            01_PRD（要件）・05_ARCHITECTURE_DESIGN（ER 図・API）・04_FEATURE_DESIGN（画面仕様）・00_CHANGELOG
├── client/public/   index.html（客）・host.html（ホスト）・app.js・styles.css  ← Worker がそのまま配信
├── server/          src/index.js（/api）・wrangler.jsonc
└── scripts/test.sh  番号生成の重複ゼロ・API の検証
```

## 動かし方
- ローカル確認：`client/public/host.html` をブラウザで開けば単独モードで動く（サーバ無し）。
- 開発サーバ：`cd server && npx wrangler dev`
- 公開：`cd server && npx wrangler deploy`（状態は Durable Object。初回 deploy で `migrations` が適用される。KV はもう使わない）
- 検討用の公開（GitHub Pages・サーバ無し＝モード A）：
  - ホスト画面 https://yoshimimkinc.github.io/techno-bingo/host.html
  - 参加者画面 https://yoshimimkinc.github.io/techno-bingo/ （Pages には API が無いので「通信断」表示のまま。参加者画面を本番で使うなら Worker へ）
  - リポジトリ https://github.com/Yoshimimkinc/techno-bingo （`main` に push すると Actions が `client/public` を配信）
- Worker 公開 URL（モード B・参加者画面が動く本番）：
  - ホスト画面 https://techno-bingo.mk-inc.workers.dev/host
  - 参加者画面（QR の飛び先） https://techno-bingo.mk-inc.workers.dev/
  - KV `BINGO`（id 1fb52fef…）。更新は `cd server && npx wrangler deploy`（2026-09-16 初回デプロイ）

## 当日の手順（案）
1. ホストのスマホで `/host` を開き「はじめる」を押す（PIN 入力は廃止。URL を教えた人しか開けないことがガード）。
2. QR（`/host` 内の「QR を見せる」）を会場に見せる／印刷して置く。参加者は読んで「みる」。
3. 「数字を引く!!」を押す → ルーレット → 確定。参加者の画面に 3 秒以内に出る。
4. 間違えたら「最後の 1 件を取り消す」。2 回戦は「新しいゲーム」。

## 当日の細かい注意
- **ロゴ**：`client/public/logo.svg`（純 SVG・外部参照なし・フォント不要）。お手本の `taitoru.jpg` は Dropbox 側にのみ置く。作り直すときは `pip install fonttools` → `python scripts/make_logo.py`。文字は **Dela Gothic One（SIL OFL 1.1）** をアウトライン化して埋め込んでいる。
- **履歴カードをタップするとドラムが鳴る**（Web Audio で合成・音源ファイル無し）。**iPhone はマナーモード（消音スイッチ）だと鳴らない**。音が要らない場面ではそのままで問題ない（押した本人にしか鳴らない）。
- **画面は拡大しない設定**にしてある（ダブルタップ・ピンチ）。スクロールは今までどおり効く。
