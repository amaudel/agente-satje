#!/usr/bin/env python3
import argparse
import json
import socket
import ssl
import time
from typing import Any
from urllib.parse import urlparse

import httpx


DEFAULT_URL = "https://api.funcionjudicial.gob.ec"
CONTROL_PATH = "/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/buscarCausas?page=1&size=10"


def timed(label: str, fn):
    started = time.perf_counter()
    try:
        value = fn()
        return {
            "stage": label,
            "ok": True,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
            "result": value,
        }
    except Exception as exc:
        return {
            "stage": label,
            "ok": False,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
            "errorType": exc.__class__.__name__,
            "error": str(exc),
            "classification": classify_exception(exc),
        }


def classify_exception(exc: Exception) -> str:
    if isinstance(exc, socket.gaierror):
        return "SATJE_DNS_ERROR"
    if isinstance(exc, (TimeoutError, socket.timeout, httpx.TimeoutException)):
        return "SATJE_TIMEOUT"
    if isinstance(exc, ssl.SSLError):
        return "SATJE_TLS_ERROR"
    if isinstance(exc, OSError):
        return "SATJE_CONNECTION_ERROR"
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {401, 403, 429}:
        return "SATJE_BLOCKED"
    return "UNKNOWN"


def resolve(host: str) -> list[dict[str, Any]]:
    answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return [
        {
            "family": "IPv6" if item[0] == socket.AF_INET6 else "IPv4",
            "address": item[4][0],
        }
        for item in answers
    ]


def tcp_connect(address: str, host: str, timeout: float) -> dict[str, Any]:
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        sock.connect((address, 443))
        return {"address": address, "host": host, "port": 443}


def tls_connect(address: str, host: str, timeout: float) -> dict[str, Any]:
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as raw:
        raw.settimeout(timeout)
        raw.connect((address, 443))
        with ssl.create_default_context().wrap_socket(raw, server_hostname=host) as tls:
            cert = tls.getpeercert()
            return {
                "address": address,
                "version": tls.version(),
                "subject": cert.get("subject"),
                "issuer": cert.get("issuer"),
            }


def http_control_request(base_url: str, timeout: float) -> dict[str, Any]:
    payload = {
        "numeroCausa": "",
        "actor": {"cedulaActor": "0104270855", "nombreActor": ""},
        "demandado": {"cedulaDemandado": "", "nombreDemandado": ""},
        "provincia": "",
        "numeroFiscalia": "",
        "recaptcha": "verdad",
        "first": 1,
        "pageSize": 10,
    }
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": "https://procesosjudiciales.funcionjudicial.gob.ec",
        "Referer": "https://procesosjudiciales.funcionjudicial.gob.ec/",
        "User-Agent": "Mozilla/5.0 satje-diagnostic/0.1",
    }
    with httpx.Client(base_url=base_url, timeout=timeout, headers=headers, follow_redirects=True) as client:
        response = client.post(CONTROL_PATH, json=payload)
        content_type = response.headers.get("content-type")
        body_start = response.text[:120]
        return {
            "statusCode": response.status_code,
            "contentType": content_type,
            "headers": {
                "server": response.headers.get("server"),
                "date": response.headers.get("date"),
                "content-length": response.headers.get("content-length"),
            },
            "bodyStart": body_start,
            "classification": "SATJE_BLOCKED"
            if response.status_code in {401, 403, 429}
            else "SATJE_CAPTCHA_REQUIRED"
            if "captcha" in body_start.lower()
            else "HTTP_OK"
            if response.status_code < 500
            else "HTTP_SERVER_ERROR",
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnostico seguro de conectividad SATJE")
    parser.add_argument("--base-url", default=DEFAULT_URL)
    parser.add_argument("--timeout", type=float, default=10)
    args = parser.parse_args()

    parsed = urlparse(args.base_url)
    host = parsed.hostname or "api.funcionjudicial.gob.ec"
    report: dict[str, Any] = {"baseUrl": args.base_url, "host": host, "checks": []}

    dns = timed("dns", lambda: resolve(host))
    report["checks"].append(dns)
    addresses = [item["address"] for item in dns.get("result", [])] if dns["ok"] else []

    for address in addresses:
        report["checks"].append(timed(f"tcp:{address}", lambda address=address: tcp_connect(address, host, args.timeout)))
        report["checks"].append(timed(f"tls:{address}", lambda address=address: tls_connect(address, host, args.timeout)))

    report["checks"].append(timed("http_control_post", lambda: http_control_request(args.base_url, args.timeout)))
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
