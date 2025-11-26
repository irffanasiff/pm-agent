#!/bin/bash
# Get a single market by slug from Polymarket via proxy
# Usage: ./pm-get-market.sh <slug>
#
# Environment variables required:
#   POLYMARKET_PROXY_URL - Proxy URL
#   PROXY_SECRET - Proxy authentication secret
#
# Example:
#   ./pm-get-market.sh will-bitcoin-hit-100k-in-2024

set -e

SLUG="${1:?Usage: pm-get-market.sh <slug>}"
PROXY="${POLYMARKET_PROXY_URL:?POLYMARKET_PROXY_URL not set}"
SECRET="${PROXY_SECRET:?PROXY_SECRET not set}"

# URL encode the Gamma API endpoint
GAMMA_URL="https://gamma-api.polymarket.com/markets/${SLUG}"
ENCODED_URL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$GAMMA_URL', safe=''))")

# Fetch via proxy
curl -s "${PROXY}/proxy/${ENCODED_URL}" \
  -H "X-Proxy-Secret: ${SECRET}" \
  -H "Accept: application/json"
