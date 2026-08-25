#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/.satje-lambda.env}"
OUTPUT_FILE="${OUTPUT_FILE:-$ROOT_DIR/.satje-lambda-output.env}"

if [ -f "$SECRETS_FILE" ]; then
  # shellcheck source=/dev/null
  . "$SECRETS_FILE"
fi
if [ -f "$OUTPUT_FILE" ]; then
  # shellcheck source=/dev/null
  . "$OUTPUT_FILE"
fi

: "${SATJE_LAMBDA_FUNCTION_URL:?SATJE_LAMBDA_FUNCTION_URL no configurado}"
: "${SATJE_LAMBDA_API_TOKEN:?SATJE_LAMBDA_API_TOKEN no configurado}"
: "${SATJE_CONNECTOR_INTERNAL_TOKEN:?SATJE_CONNECTOR_INTERNAL_TOKEN no configurado}"

python3 - <<'PY'
import json
import os
import sys
import urllib.request

url = os.environ["SATJE_LAMBDA_FUNCTION_URL"]
payload = {
    "operation": "getIncidenteJudicatura",
    "idJuicio": "01371201700497",
    "timeoutMs": 15000,
    "connectorToken": os.environ["SATJE_CONNECTOR_INTERNAL_TOKEN"],
}
request = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {os.environ['SATJE_LAMBDA_API_TOKEN']}",
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(request, timeout=25) as response:
        body = json.loads(response.read().decode("utf-8"))
except Exception as exc:
    print(f"Smoke test Function URL fallo: {exc}", file=sys.stderr)
    raise

if body.get("success") is not True:
    raise SystemExit(f"Smoke test Function URL fallo: {body}")

data = body.get("data")
count = len(data) if isinstance(data, list) else "n/a"
print(f"Smoke test Function URL OK: operation={body.get('operation')} items={count}")
PY
