# テクノのビンゴ

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
- 公開：`cd server && npx wrangler deploy`（初回は `npx wrangler kv namespace create BINGO` で KV を作り `wrangler.jsonc` に ID を書く）
- 公開 URL：（デプロイ後に記入）

## 当日の手順（案）
1. ホストのスマホで `/host` を開き PIN を入れて「はじめる」。
2. QR（`/host` 内の「QR を見せる」）を会場に見せる／印刷して置く。参加者は読んで「みる」。
3. 「数字を引く!!」を押す → ルーレット → 確定。参加者の画面に 3 秒以内に出る。
4. 間違えたら「最後の 1 件を取り消す」。2 回戦は「新しいゲーム」。
