#!/bin/bash
# List active markets from Polymarket via proxy
# Usage: ./pm-list-markets.sh [limit]
#
# Environment variables required:
#   POLYMARKET_PROXY_URL - Proxy URL
#   PROXY_SECRET - Proxy authentication secret
#
# Example:
#   ./pm-list-markets.sh 5    # Get 5 markets
#   ./pm-list-markets.sh 20   # Get 20 markets

set -e

LIMIT="${1:-10}"
PROXY="${POLYMARKET_PROXY_URL:?POLYMARKET_PROXY_URL not set}"
SECRET="${PROXY_SECRET:?PROXY_SECRET not set}"

# URL encode the Gamma API endpoint
GAMMA_URL="https://gamma-api.polymarket.com/markets?limit=${LIMIT}&active=true"
ENCODED_URL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$GAMMA_URL', safe=''))")

# Fetch via proxy
curl -s "${PROXY}/proxy/${ENCODED_URL}" \
  -H "X-Proxy-Secret: ${SECRET}" \
  -H "Accept: application/json"
