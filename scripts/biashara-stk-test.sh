#!/usr/bin/env bash
#
# Biashara partner-door live proof — collect → settle → balance → cash out.
#
# Runs the whole merchant loop with real money through the NEW partner-scoped
# door, so a successful run proves the rail AND the tenant scoping at once.
# Every read in step 5 goes through the partner key, not the service key.
#
# Cost: the amount you push (default 1,000 TZS) plus fees. Nothing is
# simulated — Biashara has no sandbox on purpose.
#
# Usage:
#   export NTZS_PARTNER_KEY=ntzs_live_xxxxxxxx      # never paste this in chat
#   export TEST_PHONE=0744277496                    # phone that will be charged
#   ./scripts/biashara-stk-test.sh
#
# Prerequisites (both in Backstage → Partners):
#   1. 'Biashara: on' for this partner
#   2. an approved KYB row for this partner
#
set -euo pipefail

BASE="${NTZS_BASE_URL:-https://www.ntzs.co.tz}"
AMOUNT="${AMOUNT_TZS:-1000}"
PHONE="${TEST_PHONE:?set TEST_PHONE to the number that should receive the prompt}"
KEY="${NTZS_PARTNER_KEY:?set NTZS_PARTNER_KEY to a live partner key with the biashara capability}"
STAMP="$(date +%Y%m%d%H%M%S)"

auth=(-H "Authorization: Bearer ${KEY}" -H "Content-Type: application/json")
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d,indent=2))"; }
field() { python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))"; }

say "0. Provision the WaaS user (identity prerequisite for any wallet)"
USER_JSON=$(curl -sS -X POST "$BASE/api/v1/users" "${auth[@]}" -d "{
  \"externalId\": \"biashara-stk-${STAMP}\",
  \"email\": \"biashara-stk-${STAMP}@nedalabs.co.tz\",
  \"name\": \"Biashara STK Test\",
  \"phone\": \"${PHONE}\",
  \"nidaNumber\": \"${TEST_NIDA:?set TEST_NIDA to a real 20-digit NIDA for this person}\"
}")
echo "$USER_JSON" | jqr
USER_ID=$(echo "$USER_JSON" | field id)
[ -n "$USER_ID" ] || { echo "No user id — stopping."; exit 1; }

say "1. Activate the merchant (partner door)"
MERCHANT_JSON=$(curl -sS -X POST "$BASE/api/v1/biashara/accounts" "${auth[@]}" -d "{
  \"userId\": \"${USER_ID}\",
  \"email\": \"biashara-stk-${STAMP}@nedalabs.co.tz\",
  \"businessName\": \"NEDA Labs STK Test\",
  \"settlementPhone\": \"${PHONE}\"
}")
echo "$MERCHANT_JSON" | jqr
MERCHANT_ID=$(echo "$MERCHANT_JSON" | field merchantId)
# Read the handle BACK — activation auto-suffixes on collision rather than failing.
HANDLE=$(echo "$MERCHANT_JSON" | field handle)
[ -n "$MERCHANT_ID" ] || { echo "No merchantId — stopping."; exit 1; }

m_auth=("${auth[@]}" -H "x-merchant-id: ${MERCHANT_ID}")

say "2. Create a payment link / QR"
curl -sS -X POST "$BASE/api/v1/biashara/links" "${m_auth[@]}" \
  -d "{\"amountTzs\": ${AMOUNT}, \"label\": \"STK proof ${STAMP}\"}" | jqr

say "3. Push the STK prompt — APPROVE IT ON ${PHONE}"
curl -sS -X POST "$BASE/api/merchant/pay" -H "Content-Type: application/json" \
  -d "{\"handle\": \"${HANDLE}\", \"phone\": \"${PHONE}\", \"amountTzs\": ${AMOUNT}, \"payerName\": \"STK Test\"}" | jqr

say "4. Waiting 45s for you to approve and for settlement to land..."
sleep 45

say "5. Verify THROUGH THE PARTNER DOOR (this is the isolation proof)"
echo "--- stats";       curl -sS "$BASE/api/v1/biashara/stats"       "${m_auth[@]}" | jqr
echo "--- collections"; curl -sS "$BASE/api/v1/biashara/collections?limit=5" "${m_auth[@]}" | jqr
echo "--- wallet";      curl -sS "$BASE/api/v1/biashara/wallet"      "${m_auth[@]}" | jqr

say "6. Isolation check — a merchant id that is NOT ours must 404, not 403"
curl -sS -o /dev/null -w 'foreign merchant id → HTTP %{http_code} (expect 404)\n' \
  "$BASE/api/v1/biashara/stats" "${auth[@]}" \
  -H "x-merchant-id: 00000000-0000-4000-8000-000000000000"

say "Done. merchantId=${MERCHANT_ID} handle=${HANDLE}"
echo "Cash out when ready (amountTzs is the NET received, min 5,000):"
echo "  curl -X POST $BASE/api/v1/biashara/withdraw \\"
echo "    -H \"Authorization: Bearer \$NTZS_PARTNER_KEY\" -H 'Content-Type: application/json' \\"
echo "    -H 'x-merchant-id: ${MERCHANT_ID}' -d '{\"amountTzs\": 5000}'"
