#!/usr/bin/env bash
# テクノのビンゴ — 検算・セルフテスト
#
# 位置づけ: 共通技術台帳/01_開発サイクル標準.md のDEVCYCLE D3（テスト）で実行する。
# 検算結果は docs/00_CHANGELOG.md の版履歴に「検算: n/n PASS」として記録する（省略不可）。
#
# 実行: bash scripts/test.sh   （Node 18 以上。外部パッケージは使わない）

set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== 1. 番号生成（1,000ゲーム × 75回・重複ゼロ／出し切り／76回目は打ち止め） ==="
node scripts/pool_test.js

echo
echo "=== 2. QR生成（BCH公表値／規定位置／配置→復号の往復） ==="
node scripts/qr_test.js

echo
echo "=== 3. /api（PIN・409・ETag 304・sync・通信断からの復帰） ==="
node scripts/api_test.mjs

echo
echo "=== 4. 配色（未出は背景と同化＝比1.3以下／出た・最新ははっきり） ==="
node scripts/contrast_test.js

echo
echo "[test.sh] ALL PASS"
