#!/usr/bin/env python3
import json
import os
import socket
import ssl
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
STAGING_HOST = os.environ.get("STAGING_PUBLIC_HOST", "staging-api.asitentekairon.cloud")
STAGING_PUBLIC_IP = os.environ.get("STAGING_PUBLIC_IP", "187.77.41.236")
DIRECT_BASE_URL = os.environ.get("STAGING_DIRECT_BASE_URL", "http://127.0.0.1:8011").rstrip("/")
NGINX_LOCAL_BASE_URL = os.environ.get("STAGING_NGINX_LOCAL_BASE_URL", "http://127.0.0.1").rstrip("/")


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def request_json(url: str, headers: dict[str, str] | None = None, timeout: int = 20) -> dict[str, Any]:
    request = Request(url, headers=headers or {})
    with urlopen(request, timeout=timeout) as response:
        body = response.read()
        content_type = response.headers.get("content-type", "")
        value: Any
        if "application/json" in content_type:
            value = json.loads(body.decode("utf-8"))
        else:
            value = body.decode("utf-8", errors="replace")[:200]
        return {
            "statusCode": response.status,
            "contentType": content_type,
            "value": value,
        }


def run_check(name: str, fn) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        return {
            "name": name,
            "ok": True,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
            **fn(),
        }
    except HTTPError as exc:
        return {
            "name": name,
            "ok": False,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
            "statusCode": exc.code,
            "error": exc.__class__.__name__,
            "message": str(exc),
        }
    except (OSError, URLError, ssl.SSLError, TimeoutError) as exc:
        return {
            "name": name,
            "ok": False,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
            "error": exc.__class__.__name__,
            "message": str(exc),
        }


def summarize_payload(response: dict[str, Any]) -> dict[str, Any]:
    value = response.get("value")
    if not isinstance(value, dict):
        return response
    summary = {
        "statusCode": response["statusCode"],
        "success": value.get("success"),
        "mode": value.get("mode") or value.get("satje_mode"),
        "requestId": value.get("requestId"),
        "total": value.get("total"),
        "totalItems": (value.get("pagination") or {}).get("totalItems"),
        "status": value.get("status"),
    }
    return {key: val for key, val in summary.items() if val is not None}


def main() -> None:
    load_env(ROOT / ".env.staging")
    api_key = os.environ.get("API_KEYS", "").split(",", 1)[0].strip()
    ops_api_key = os.environ.get("OPS_API_KEYS", "").split(",", 1)[0].strip()
    id_juicio = os.environ.get("STAGING_VALIDATE_ID_JUICIO", "01371201700497")
    api_headers = {"X-API-Key": api_key} if api_key else {}
    ops_headers = {"X-API-Key": ops_api_key} if ops_api_key else {}
    host_headers = {"Host": STAGING_HOST}

    checks: list[dict[str, Any]] = []
    checks.append(run_check("directHealth", lambda: request_json(f"{DIRECT_BASE_URL}/health")))
    checks.append(
        run_check(
            "localNginxHealth",
            lambda: request_json(f"{NGINX_LOCAL_BASE_URL}/health", headers=host_headers),
        )
    )
    checks.append(
        run_check(
            "publicHttpByIpAndHost",
            lambda: request_json(f"http://{STAGING_PUBLIC_IP}/health", headers=host_headers),
        )
    )
    checks.append(
        run_check(
            "satjeHealth",
            lambda: summarize_payload(request_json(f"{DIRECT_BASE_URL}/health/satje", headers=ops_headers)),
        )
    )
    checks.append(
        run_check(
            "actuacionesPaginadas",
            lambda: summarize_payload(
                request_json(
                    f"{DIRECT_BASE_URL}/api/v1/causas/{id_juicio}/actuaciones/paginadas?page=1&pageSize=3&orden=desc",
                    headers=api_headers,
                )
            ),
        )
    )
    checks.append(
        run_check(
            "resoluciones",
            lambda: summarize_payload(
                request_json(
                    f"{DIRECT_BASE_URL}/api/v1/causas/{id_juicio}/resoluciones?limit=3",
                    headers=api_headers,
                )
            ),
        )
    )

    dns_records: list[str] = []
    try:
        dns_records = socket.gethostbyname_ex(STAGING_HOST)[2]
    except OSError:
        dns_records = []

    https_check: dict[str, Any]
    if dns_records:
        https_check = run_check("publicHttps", lambda: request_json(f"https://{STAGING_HOST}/health"))
    else:
        https_check = {
            "name": "publicHttps",
            "ok": False,
            "skipped": True,
            "message": "DNS does not resolve yet; issue TLS after the A record is active.",
        }
    checks.append(https_check)

    ready = {
        "service": all(check["ok"] for check in checks if check["name"] in {"directHealth", "satjeHealth"}),
        "localProxy": any(check["name"] == "localNginxHealth" and check["ok"] for check in checks),
        "publicHttp": any(check["name"] == "publicHttpByIpAndHost" and check["ok"] for check in checks),
        "publicDns": STAGING_PUBLIC_IP in dns_records,
        "publicHttps": any(check["name"] == "publicHttps" and check["ok"] for check in checks),
    }
    if all(ready.values()):
        next_step = "Staging is public and ready over HTTPS."
    elif not ready["publicDns"]:
        next_step = f"Create DNS A record staging-api -> {STAGING_PUBLIC_IP}, then run certbot for staging."
    elif not ready["publicHttps"]:
        next_step = f"Run certbot for {STAGING_HOST}."
    else:
        next_step = "Review failed checks before exposing staging."

    result = {
        "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stagingHost": STAGING_HOST,
        "expectedPublicIp": STAGING_PUBLIC_IP,
        "dnsRecords": dns_records,
        "mode": os.environ.get("SATJE_MODE"),
        "checks": checks,
        "ready": ready,
        "nextStep": next_step,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
