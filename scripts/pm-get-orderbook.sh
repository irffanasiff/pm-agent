#!/bin/bash
# Get orderbook for a token from Polymarket CLOB API via proxy
# Usage: ./pm-get-orderbook.sh <token_id>
#
# Environment variables required:
#   POLYMARKET_PROXY_URL - Proxy URL
#   PROXY_SECRET - Proxy authentication secret
#   POLYMARKET_API_KEY - CLOB API key
#   POLYMARKET_SECRET - CLOB API secret
#   POLYMARKET_PASSPHRASE - CLOB API passphrase
#
# Example:
#   ./pm-get-orderbook.sh 123456789

set -e

TOKEN_ID="${1:?Usage: pm-get-orderbook.sh <token_id>}"
PROXY="${POLYMARKET_PROXY_URL:?POLYMARKET_PROXY_URL not set}"
SECRET="${PROXY_SECRET:?PROXY_SECRET not set}"
API_KEY="${POLYMARKET_API_KEY:?POLYMARKET_API_KEY not set}"
API_SECRET="${POLYMARKET_SECRET:?POLYMARKET_SECRET not set}"
PASSPHRASE="${POLYMARKET_PASSPHRASE:?POLYMARKET_PASSPHRASE not set}"

# Build path and timestamp for HMAC
PATH_STR="/book?token_id=${TOKEN_ID}"
TIMESTAMP=$(date +%s)

# Create HMAC signature
MESSAGE="${TIMESTAMP}GET${PATH_STR}"
SIGNATURE=$(echo -n "$MESSAGE" | openssl dgst -sha256 -hmac "$(echo -n "$API_SECRET" | base64 -d)" -binary | base64)

# URL encode the CLOB API endpoint
CLOB_URL="https://clob.polymarket.com${PATH_STR}"
ENCODED_URL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CLOB_URL', safe=''))")

# Fetch via proxy with auth headers
curl -s "${PROXY}/proxy/${ENCODED_URL}" \
  -H "X-Proxy-Secret: ${SECRET}" \
  -H "POLY_API_KEY: ${API_KEY}" \
  -H "POLY_SIGNATURE: ${SIGNATURE}" \
  -H "POLY_TIMESTAMP: ${TIMESTAMP}" \
  -H "POLY_PASSPHRASE: ${PASSPHRASE}" \
  -H "Accept: application/json"
