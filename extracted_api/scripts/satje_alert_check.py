#!/usr/bin/env python3
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


ROOT = Path(__file__).resolve().parents[1]
DOMAIN = os.environ.get("PUBLIC_API_HOST", "api.asitentekairon.cloud")
BASE_URL = os.environ.get("PUBLIC_API_BASE_URL", f"https://{DOMAIN}").rstrip("/")


def load_env() -> None:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def cert_days_left(hostname: str) -> int | None:
    # Avoid private OpenSSL internals for the live check; use openssl CLI present
    # on the VPS and parse the notAfter line.
    proc = subprocess.run(
        ["openssl", "s_client", "-connect", f"{hostname}:443", "-servername", hostname],
        input=b"",
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=10,
        check=False,
    )
    proc2 = subprocess.run(
        ["openssl", "x509", "-noout", "-enddate"],
        input=proc.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=10,
        check=False,
    )
    text = proc2.stdout.decode().strip()
    if not text.startswith("notAfter="):
        return None
    expires = datetime.strptime(text.removeprefix("notAfter="), "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    return (expires - datetime.now(timezone.utc)).days


def service_active(name: str) -> bool:
    proc = subprocess.run(["systemctl", "is-active", name], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    return proc.stdout.decode().strip() == "active"


def main() -> None:
    load_env()
    alerts: list[dict[str, Any]] = []
    ops_api_key = os.environ.get("OPS_API_KEYS", "").split(",", 1)[0].strip()
    ops_headers = {"X-API-Key": ops_api_key} if ops_api_key else {}

    with httpx.Client(timeout=20) as client:
        try:
            health = client.get(f"{BASE_URL}/health")
            if health.status_code != 200:
                alerts.append({"code": "API_HEALTH_BAD", "message": f"/health status {health.status_code}"})
        except Exception as exc:
            alerts.append({"code": "API_HEALTH_UNREACHABLE", "message": str(exc)})

        try:
            satje = client.get(f"{BASE_URL}/health/satje", headers=ops_headers)
            payload = satje.json()
            if satje.status_code >= 500 or payload.get("status") != "ok":
                alerts.append({"code": "SATJE_CONNECTOR_DEGRADED", "message": json.dumps(payload, ensure_ascii=False)[:500]})
        except Exception as exc:
            alerts.append({"code": "SATJE_HEALTH_UNREACHABLE", "message": str(exc)})

        if ops_headers:
            try:
                metrics = client.get(f"{BASE_URL}/api/v1/ops/metrics", headers=ops_headers, params={"since_seconds": 3600})
                if metrics.status_code == 200:
                    summary = metrics.json()
                    for stage, item in summary.get("stages", {}).items():
                        total = item.get("total") or 0
                        failure = item.get("failure") or 0
                        if total and failure / total >= 0.2:
                            alerts.append({"code": "HIGH_ERROR_RATE", "stage": stage, "failureRate": round(failure / total, 3)})
            except Exception as exc:
                alerts.append({"code": "METRICS_UNAVAILABLE", "message": str(exc)})

    if not service_active("ecuador-judicial-api"):
        alerts.append({"code": "SYSTEMD_SERVICE_DOWN", "service": "ecuador-judicial-api"})

    actor_id = os.environ.get("SATJE_CONNECTOR_ACTOR_ID", "").strip()
    apify_token = os.environ.get("SATJE_CONNECTOR_API_TOKEN", "").strip()
    if actor_id and apify_token:
        try:
            threshold = float(os.environ.get("ALERT_APIFY_HOURLY_USD", "1"))
            since_ms = int((time.time() - 3600) * 1000)
            response = httpx.get(
                "https://api.apify.com/v2/actor-runs",
                headers={"Authorization": f"Bearer {apify_token}"},
                params={"limit": 100, "desc": "true", "actorId": actor_id},
                timeout=20,
            )
            if response.status_code == 200:
                total = 0.0
                runs = 0
                for run in response.json().get("data", {}).get("items", []):
                    started_at = run.get("startedAt") or ""
                    try:
                        started_ts = datetime.fromisoformat(started_at.replace("Z", "+00:00")).timestamp() * 1000
                    except ValueError:
                        started_ts = 0
                    if started_ts >= since_ms:
                        runs += 1
                        total += float(run.get("usageTotalUsd") or 0)
                if total >= threshold:
                    alerts.append({"code": "APIFY_COST_HIGH", "lastHourUsd": round(total, 6), "runs": runs})
        except Exception as exc:
            alerts.append({"code": "APIFY_USAGE_CHECK_FAILED", "message": str(exc)})

    try:
        days = cert_days_left(DOMAIN)
        if days is not None and days <= 21:
            alerts.append({"code": "CERT_EXPIRING", "domain": DOMAIN, "daysLeft": days})
    except Exception as exc:
        alerts.append({"code": "CERT_CHECK_FAILED", "message": str(exc)})

    output = {"ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "alerts": alerts}
    print(json.dumps(output, ensure_ascii=False, indent=2))

    webhook = os.environ.get("ALERT_WEBHOOK_URL")
    if webhook and alerts:
        httpx.post(webhook, json=output, timeout=20)

    raise SystemExit(1 if alerts else 0)


if __name__ == "__main__":
    main()
