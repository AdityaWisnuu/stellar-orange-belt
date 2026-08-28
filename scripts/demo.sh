#!/usr/bin/env bash
# KIRIM — CLI walkthrough of the full escrow lifecycle on Stellar testnet.
# Prasyarat: stellar CLI + dua identitas funded (sender, recipient):
#   stellar keys generate sender --network testnet --fund
#   stellar keys generate recipient --network testnet --fund
set -euo pipefail

CONTRACT="${CONTRACT:-CC7WCFBM2CRUW36KTJZB67SJTSX3XHXCO7J2IJDILETKP4OFQHBT6XIZ}"
SENDER="${SENDER:-sender}"
RECIPIENT="${RECIPIENT:-recipient}"

sender_pk=$(stellar keys address "$SENDER")
recipient_pk=$(stellar keys address "$RECIPIENT")

echo "== 1. send: kunci 10 XLM untuk $recipient_pk (window 1 hari)"
id=$(stellar contract invoke --id "$CONTRACT" --source "$SENDER" --network testnet -- \
  send --sender "$sender_pk" --recipient "$recipient_pk" \
  --amount 100000000 --memo "demo dari scripts/demo.sh" --ttl_ledgers 17280 | tail -1)
echo "   transfer id: $id"

echo "== 2. get_transfer: status harus Pending"
stellar contract invoke --id "$CONTRACT" --source "$SENDER" --network testnet -- \
  get_transfer --id "$id" | tail -1

echo "== 3. claim: penerima menarik dana"
stellar contract invoke --id "$CONTRACT" --source "$RECIPIENT" --network testnet -- \
  claim --id "$id" | tail -1

echo "== 4. get_transfer: status harus Claimed (1)"
stellar contract invoke --id "$CONTRACT" --source "$SENDER" --network testnet -- \
  get_transfer --id "$id" | tail -1

echo "Selesai. Untuk menguji refund: kirim dengan --ttl_ledgers 12, tunggu ±1 menit, lalu panggil refund --id <id> dari sisi sender."
