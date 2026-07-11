#!/usr/bin/env bash
# Logbin shipper — tail a file and POST new lines to your Logbin instance.
# Usage: LOGBIN_URL=http://box:5347 LOGBIN_KEY=lb_xxx ./shipper.sh /var/log/app.log
set -euo pipefail

FILE="${1:?usage: shipper.sh <logfile>}"
: "${LOGBIN_URL:?set LOGBIN_URL (e.g. http://localhost:5347)}"
: "${LOGBIN_KEY:?set LOGBIN_KEY (source api key)}"

echo "shipping $FILE → $LOGBIN_URL/ingest" >&2
tail -n 0 -F "$FILE" | while IFS= read -r line; do
  curl -fsS -X POST "$LOGBIN_URL/ingest" \
    -H "X-Api-Key: $LOGBIN_KEY" \
    -H "Content-Type: text/plain" \
    --data-binary "$line" >/dev/null || echo "ship failed: $line" >&2
done
