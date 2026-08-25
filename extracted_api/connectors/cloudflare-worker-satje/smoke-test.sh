#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/.satje-cloudflare.env}"
OUTPUT_FILE="${OUTPUT_FILE:-$ROOT_DIR/.satje-cloudflare-output.env}"

if [ -f "$SECRETS_FILE" ]; then
  # shellcheck source=/dev/null
  . "$SECRETS_FILE"
fi
if [ -f "$OUTPUT_FILE" ]; then
  # shellcheck source=/dev/null
  . "$OUTPUT_FILE"
fi

: "${SATJE_CLOUDFLARE_WORKER_URL:?SATJE_CLOUDFLARE_WORKER_URL no configurado}"
: "${SATJE_CLOUDFLARE_API_TOKEN:?SATJE_CLOUDFLARE_API_TOKEN no configurado}"
: "${SATJE_CONNECTOR_INTERNAL_TOKEN:?SATJE_CONNECTOR_INTERNAL_TOKEN no configurado}"

python3 - <<'PY'
import json
import os
import sys
import urllib.request

url = os.environ["SATJE_CLOUDFLARE_WORKER_URL"]
payload = {
    "operation": "buscarCausas",
    "page": 1,
    "size": 10,
    "payload": {
        "numeroCausa": "",
        "actor": {"cedulaActor": "0102030405", "nombreActor": ""},
        "demandado": {"cedulaDemandado": "", "nombreDemandado": ""},
        "provincia": "",
        "numeroFiscalia": "",
        "recaptcha": "",
        "first": 0,
        "pageSize": 10,
    },
    "timeoutMs": 15000,
    "connectorToken": os.environ["SATJE_CONNECTOR_INTERNAL_TOKEN"],
}
request = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {os.environ['SATJE_CLOUDFLARE_API_TOKEN']}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 satje-api/1.0",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(request, timeout=25) as response:
        body = json.loads(response.read().decode("utf-8"))
except Exception as exc:
    print(f"Smoke test Cloudflare Worker fallo: {exc}", file=sys.stderr)
    raise

if body.get("success") is not True:
    raise SystemExit(f"Smoke test Cloudflare Worker fallo: {body}")

data = body.get("data")
count = len(data) if isinstance(data, list) else "n/a"
print(f"Smoke test Cloudflare Worker OK: operation={body.get('operation')} items={count}")
PY
