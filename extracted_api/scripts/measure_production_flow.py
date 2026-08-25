#!/usr/bin/env python3
import json
import os
import time
from pathlib import Path
from typing import Any

import httpx


ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def timed(label: str, fn) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        value = fn()
        return {
            "stage": label,
            "ok": True,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
            "value": value,
        }
    except Exception as exc:
        return {
            "stage": label,
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
    cedula = os.environ.get("MEASURE_CEDULA", "0104270855")
    id_juicio = os.environ.get("MEASURE_ID_JUICIO", "01371201700497")
    headers = {"X-API-Key": api_key}
    ops_headers = {"X-API-Key": ops_api_key} if ops_api_key else {}
    result: dict[str, Any] = {
        "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "baseUrl": base_url,
        "mode": os.environ.get("SATJE_MODE"),
        "backend": os.environ.get("SATJE_LIVE_BACKEND"),
        "cedulaMasked": f"{cedula[:4]}**{cedula[-2:]}",
        "idJuicio": id_juicio,
        "stages": [],
    }

    with httpx.Client(timeout=180) as client:
        result["stages"].append(
            timed(
                "buscarCausas",
                lambda: client.post(
                    f"{base_url}/api/v1/causas/buscar",
                    headers=headers,
                    json={"cedula": cedula, "roles": ["actor", "demandado"], "incluirTodasLasPaginas": True},
                ),
            )
        )
        if result["stages"][-1]["ok"]:
            response = result["stages"][-1]["value"]
            response.raise_for_status()
            payload = response.json()
            result["stages"][-1]["summary"] = {
                "statusCode": response.status_code,
                "requestId": payload.get("requestId"),
                "total": payload.get("total"),
                "cache": payload.get("cache"),
            }
            result["stages"][-1].pop("value", None)

        result["stages"].append(
            timed(
                "getIncidenteJudicatura+actuacionesJudiciales",
                lambda: client.get(f"{base_url}/api/v1/causas/{id_juicio}/actuaciones", headers=headers),
            )
        )
        if result["stages"][-1]["ok"]:
            response = result["stages"][-1]["value"]
            response.raise_for_status()
            payload = response.json()
            result["stages"][-1]["summary"] = {
                "statusCode": response.status_code,
                "requestId": payload.get("requestId"),
                "totalIncidentes": payload.get("totalIncidentes"),
                "totalActuaciones": payload.get("totalActuaciones"),
                "cache": payload.get("cache"),
            }
            result["stages"][-1].pop("value", None)

        result["stages"].append(
            timed(
                "pdfGeneration",
                lambda: client.post(f"{base_url}/api/v1/causas/{id_juicio}/pdf", headers=headers),
            )
        )
        if result["stages"][-1]["ok"]:
            response = result["stages"][-1]["value"]
            response.raise_for_status()
            result["stages"][-1]["summary"] = {
                "statusCode": response.status_code,
                "requestId": response.headers.get("x-request-id"),
                "pdfDurationMs": response.headers.get("x-pdf-duration-ms"),
                "bytes": len(response.content),
                "contentType": response.headers.get("content-type"),
            }
            result["stages"][-1].pop("value", None)

        metrics = client.get(f"{base_url}/api/v1/ops/metrics", headers=ops_headers, params={"since_seconds": 3600})
        if ops_headers and metrics.status_code == 200:
            result["metricsLastHour"] = metrics.json()

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
