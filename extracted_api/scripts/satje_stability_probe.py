#!/usr/bin/env python3
import json
import os
import time
from pathlib import Path
from typing import Any

import httpx


ROOT = Path(__file__).resolve().parents[1]
LOG_PATH = ROOT / "artifacts" / "satje-stability.jsonl"


def load_env() -> None:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def mask_cedula(value: str) -> str:
    return f"{value[:4]}**{value[-2:]}" if len(value) > 4 else "*" * len(value)


def request(client: httpx.Client, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        response = client.request(method, url, **kwargs)
        payload: Any = None
        if response.headers.get("content-type", "").startswith("application/json"):
            payload = response.json()
        return {
            "ok": 200 <= response.status_code < 400,
            "statusCode": response.status_code,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
            "requestId": response.headers.get("x-request-id") or (payload or {}).get("requestId") if isinstance(payload, dict) else None,
            "summary": {
                "total": payload.get("total") if isinstance(payload, dict) else None,
                "totalIncidentes": payload.get("totalIncidentes") if isinstance(payload, dict) else None,
                "totalActuaciones": payload.get("totalActuaciones") if isinstance(payload, dict) else None,
                "cache": payload.get("cache") if isinstance(payload, dict) else None,
                "bytes": len(response.content),
            },
        }
    except Exception as exc:
        return {
            "ok": False,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
            "error": exc.__class__.__name__,
            "message": str(exc),
        }


def main() -> None:
    load_env()
    base_url = os.environ.get("PUBLIC_API_BASE_URL", "https://api.asitentekairon.cloud").rstrip("/")
    api_key = os.environ["API_KEYS"].split(",", 1)[0].strip()
    ops_api_key = os.environ.get("OPS_API_KEYS", "").split(",", 1)[0].strip()
    cedula = os.environ.get("STABILITY_CEDULA", "0104270855")
    id_juicio = os.environ.get("STABILITY_ID_JUICIO", "01371201700497")
    headers = {"X-API-Key": api_key}
    ops_headers = {"X-API-Key": ops_api_key} if ops_api_key else {}

    entry: dict[str, Any] = {
        "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mode": os.environ.get("SATJE_MODE"),
        "backend": os.environ.get("SATJE_LIVE_BACKEND"),
        "cedulaMasked": mask_cedula(cedula),
        "idJuicio": id_juicio,
        "checks": {},
    }

    with httpx.Client(timeout=180) as client:
        entry["checks"]["health"] = request(client, "GET", f"{base_url}/health")
        entry["checks"]["satjeHealth"] = request(client, "GET", f"{base_url}/health/satje", headers=ops_headers)
        entry["checks"]["buscarCausas"] = request(
            client,
            "POST",
            f"{base_url}/api/v1/causas/buscar",
            headers=headers,
            json={"cedula": cedula, "roles": ["actor", "demandado"], "incluirTodasLasPaginas": True},
        )
        entry["checks"]["actuaciones"] = request(client, "GET", f"{base_url}/api/v1/causas/{id_juicio}/actuaciones", headers=headers)
        entry["checks"]["pdf"] = request(client, "POST", f"{base_url}/api/v1/causas/{id_juicio}/pdf", headers=headers)
        metrics = request(client, "GET", f"{base_url}/api/v1/ops/metrics", headers=ops_headers, params={"since_seconds": 86400})
        entry["checks"]["metrics"] = metrics

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(json.dumps(entry, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
