#!/usr/bin/env bash
# KIRIM — alur deploy kontrak yang bisa diulang (testnet).
# Pakai: ./scripts/deploy.sh [identity]   (default: deployer)
set -euo pipefail

IDENTITY="${1:-deployer}"
NETWORK="${NETWORK:-testnet}"

echo "== 1. test"
cargo test --workspace

echo "== 2. build wasm"
stellar contract build

echo "== 3. resolve native XLM Stellar Asset Contract"
TOKEN=$(stellar contract id asset --asset native --network "$NETWORK")
echo "   token: $TOKEN"

echo "== 4. deploy (constructor: token)"
CONTRACT=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/kirim.wasm \
  --source "$IDENTITY" --network "$NETWORK" \
  -- --token "$TOKEN" | tail -1)

echo "== Deployed: $CONTRACT"
echo "   Selanjutnya: perbarui CONTRACT_ID di web/src/main.js dan README.md"
