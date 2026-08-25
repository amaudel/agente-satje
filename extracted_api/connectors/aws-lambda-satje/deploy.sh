#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONNECTOR_DIR="$ROOT_DIR/connectors/aws-lambda-satje"
SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/.satje-lambda.env}"
OUTPUT_FILE="${OUTPUT_FILE:-$ROOT_DIR/.satje-lambda-output.env}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
FUNCTION_NAME="${FUNCTION_NAME:-satje-aws-lambda-connector}"
ROLE_NAME="${ROLE_NAME:-satje-aws-lambda-connector-role}"
RUNTIME="${RUNTIME:-nodejs20.x}"
TIMEOUT="${TIMEOUT:-30}"
MEMORY_SIZE="${MEMORY_SIZE:-256}"
ZIP_PATH="$CONNECTOR_DIR/satje-aws-lambda-connector.zip"
AWS_BIN="${AWS_BIN:-aws}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Falta '$1'. Instala/configura esa herramienta y vuelve a ejecutar." >&2
    exit 1
  fi
}

secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  fi
}

need python3

if ! command -v "$AWS_BIN" >/dev/null 2>&1; then
  if [ -x "$ROOT_DIR/.venv/bin/aws" ]; then
    AWS_BIN="$ROOT_DIR/.venv/bin/aws"
  else
    echo "Falta 'aws'. Instala AWS CLI o ejecuta: .venv/bin/python -m pip install awscli" >&2
    exit 1
  fi
fi

if ! "$AWS_BIN" sts get-caller-identity --region "$REGION" >/dev/null 2>&1; then
  echo "AWS no tiene credenciales validas en este entorno. Ejecuta 'aws configure' o exporta AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY." >&2
  exit 1
fi

if [ -f "$SECRETS_FILE" ]; then
  # shellcheck source=/dev/null
  . "$SECRETS_FILE"
else
  umask 077
  {
    echo "CONNECTOR_TOKEN=$(secret)"
    echo "LAMBDA_API_TOKEN=$(secret)"
  } >"$SECRETS_FILE"
  # shellcheck source=/dev/null
  . "$SECRETS_FILE"
fi

: "${CONNECTOR_TOKEN:?CONNECTOR_TOKEN no configurado}"
: "${LAMBDA_API_TOKEN:?LAMBDA_API_TOKEN no configurado}"

python3 - <<PY
from pathlib import Path
import zipfile

connector = Path("$CONNECTOR_DIR")
zip_path = Path("$ZIP_PATH")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in ("index.mjs", "package.json", "README.md"):
        archive.write(connector / name, name)
print(zip_path)
PY

"$AWS_BIN" --version
ACCOUNT_ID="$("$AWS_BIN" sts get-caller-identity --region "$REGION" --query Account --output text)"
ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"

if ! "$AWS_BIN" iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  POLICY_FILE="$(mktemp)"
  cat >"$POLICY_FILE" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
  "$AWS_BIN" iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$POLICY_FILE" \
    --region "$REGION" >/dev/null
  rm -f "$POLICY_FILE"
  "$AWS_BIN" iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
    --region "$REGION" >/dev/null
  echo "Rol IAM creado. Esperando propagacion..."
  sleep 12
fi

ENV_VARS="Variables={CONNECTOR_TOKEN=$CONNECTOR_TOKEN,LAMBDA_API_TOKEN=$LAMBDA_API_TOKEN}"

if "$AWS_BIN" lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  "$AWS_BIN" lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$ZIP_PATH" \
    --region "$REGION" >/dev/null
  "$AWS_BIN" lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
  "$AWS_BIN" lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --timeout "$TIMEOUT" \
    --memory-size "$MEMORY_SIZE" \
    --environment "$ENV_VARS" \
    --region "$REGION" >/dev/null
else
  "$AWS_BIN" lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --timeout "$TIMEOUT" \
    --memory-size "$MEMORY_SIZE" \
    --zip-file "fileb://$ZIP_PATH" \
    --environment "$ENV_VARS" \
    --region "$REGION" >/dev/null
fi

"$AWS_BIN" lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null || true

if ! FUNCTION_URL="$("$AWS_BIN" lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" --query FunctionUrl --output text 2>/dev/null)"; then
  FUNCTION_URL="$("$AWS_BIN" lambda create-function-url-config \
    --function-name "$FUNCTION_NAME" \
    --auth-type NONE \
    --region "$REGION" \
    --query FunctionUrl \
    --output text)"
fi

"$AWS_BIN" lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id FunctionURLAllowPublicInvoke \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE \
  --region "$REGION" >/dev/null 2>&1 || true

PAYLOAD_FILE="$(mktemp)"
RESULT_FILE="$(mktemp)"
cat >"$PAYLOAD_FILE" <<JSON
{
  "operation": "getIncidenteJudicatura",
  "idJuicio": "01371201700497",
  "timeoutMs": 15000,
  "connectorToken": "$CONNECTOR_TOKEN"
}
JSON
"$AWS_BIN" lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --payload "fileb://$PAYLOAD_FILE" \
  --region "$REGION" \
  "$RESULT_FILE" >/dev/null

python3 - <<PY
import json
from pathlib import Path

raw = json.loads(Path("$RESULT_FILE").read_text())
body = json.loads(raw.get("body", "{}")) if isinstance(raw, dict) and "body" in raw else raw
if body.get("success") is not True:
    raise SystemExit(f"Smoke test Lambda fallo: {body}")
print("Smoke test Lambda OK:", body.get("operation"))
PY
rm -f "$PAYLOAD_FILE" "$RESULT_FILE"

umask 077
cat >"$OUTPUT_FILE" <<EOF
SATJE_MODE=live
SATJE_LIVE_BACKEND=aws_lambda
SATJE_LAMBDA_FUNCTION_URL=$FUNCTION_URL
SATJE_LAMBDA_API_TOKEN=$LAMBDA_API_TOKEN
SATJE_CONNECTOR_INTERNAL_TOKEN=$CONNECTOR_TOKEN
SATJE_CONNECTOR_TIMEOUT_SECONDS=30
SATJE_CONNECTOR_MAX_CONCURRENCY=2
SATJE_CONNECTOR_RETRY_ATTEMPTS=2
SATJE_CONNECTOR_BACKOFF_SECONDS=1
EOF

echo "Lambda lista: $FUNCTION_URL"
echo "Variables para la API principal: $OUTPUT_FILE"
