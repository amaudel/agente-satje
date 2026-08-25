import asyncio
import base64
import json
import socket
import ssl
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from .config import settings
from .errors import ApiError, ErrorCode
from .metrics import record_metric
from .observability import current_request_id
from .source import SATJE_ACTUACIONES_PATH, SATJE_BUSCAR_CAUSAS_PATH, SATJE_HEADERS


SATJE_INCIDENTES_PATH = (
    "/EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/"
    "informacion/getIncidenteJudicatura/{id_juicio}"
)
SATJE_DOCUMENT_HBA_PATH = "/CJ-DOCUMENTO-SERVICE/api/document/query/hba"
SATJE_ANEXOS_PATH = "/EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/datos/anexos"
EXAMPLES_DIR = Path(__file__).resolve().parents[1] / "examples"
ARTIFACTS_DIR = Path(__file__).resolve().parents[1] / "artifacts"
_connector_semaphore: asyncio.Semaphore | None = None


def _get_connector_semaphore() -> asyncio.Semaphore:
    global _connector_semaphore
    limit = max(1, settings.satje_connector_max_concurrency)
    if _connector_semaphore is None:
        _connector_semaphore = asyncio.Semaphore(limit)
    return _connector_semaphore


class CircuitBreaker:
    def __init__(self) -> None:
        self.failures = 0
        self.opened_at: float | None = None

    def ensure_available(self) -> None:
        if self.opened_at is None:
            return
        if time.time() - self.opened_at >= settings.satje_circuit_reset_seconds:
            self.failures = 0
            self.opened_at = None
            return
        raise ApiError(
            ErrorCode.SATJE_CONNECTION_ERROR,
            "satje_connector",
            message="Circuit breaker abierto para SATJE.",
            status_code=503,
        )

    def record_success(self) -> None:
        self.failures = 0
        self.opened_at = None

    def record_failure(self) -> None:
        self.failures += 1
        if self.failures >= max(1, settings.satje_circuit_failure_threshold):
            self.opened_at = time.time()


_circuit_breaker = CircuitBreaker()


class SatjeClient(ABC):
    mode: str

    @abstractmethod
    async def buscar_causas_por_cedula(
        self,
        cedula: str,
        *,
        role: str,
        page: int,
        size: int,
    ) -> Any:
        raise NotImplementedError

    @abstractmethod
    async def obtener_incidentes_por_juicio(self, id_juicio: str) -> Any:
        raise NotImplementedError

    @abstractmethod
    async def obtener_actuaciones(self, payload: dict[str, Any]) -> Any:
        raise NotImplementedError

    @abstractmethod
    async def obtener_documento_hba(self, code: str) -> dict[str, Any]:
        raise NotImplementedError

    async def obtener_anexos_actuacion(self, payload: dict[str, Any]) -> Any:
        # Metodo no abstracto a proposito: los clientes que no lo sobreescriben
        # (fixtures de test antiguos, clientes futuros) devuelven "sin anexos"
        # en vez de romper, y el llamador cae al documento principal por uuid.
        return []

    async def healthcheck(self) -> dict[str, Any]:
        return {"mode": self.mode, "available": self.mode != "live"}


def buscar_causas_payload(cedula: str, *, role: str, page: int, size: int) -> dict[str, Any]:
    actor_cedula = cedula if role == "actor" else ""
    demandado_cedula = cedula if role == "demandado" else ""
    return {
        "numeroCausa": "",
        "actor": {
            "cedulaActor": actor_cedula,
            "nombreActor": "",
        },
        "demandado": {
            "cedulaDemandado": demandado_cedula,
            "nombreDemandado": "",
        },
        "provincia": "",
        "numeroFiscalia": "",
        "recaptcha": "verdad",
        "first": page,
        "pageSize": size,
    }


def build_actuaciones_payload(incidente: dict[str, Any], id_juicio: str) -> dict[str, Any]:
    return {
        "idMovimientoJuicioIncidente": incidente.get("idMovimientoJuicioIncidente"),
        "idJuicio": str(incidente.get("idJuicio") or id_juicio).strip(),
        "idJudicatura": str(incidente.get("idJudicatura") or incidente.get("idJudicaturaDestino") or "").strip(),
        "idIncidenteJudicatura": incidente.get("idIncidenteJudicatura"),
        "aplicativo": "web",
        "nombreJudicatura": incidente.get("nombreJudicatura") or "",
        "incidente": incidente.get("incidente") or 1,
    }


def normalize_incidente(item: dict[str, Any], id_juicio: str) -> dict[str, Any]:
    return build_actuaciones_payload(item, id_juicio)


def extract_incidentes(data: Any, id_juicio: str) -> list[dict[str, Any]]:
    nested_rows: list[dict[str, Any]] = []
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = []
        for key in ("incidentes", "data", "items", "content", "procesos"):
            value = data.get(key)
            if isinstance(value, list):
                rows = value
                break
        if not rows and {"idMovimientoJuicioIncidente", "idIncidenteJudicatura"} & set(data):
            rows = [data]
    else:
        rows = []

    for row in rows:
        if not isinstance(row, dict):
            continue
        incidentes = row.get("lstIncidenteJudicatura")
        if isinstance(incidentes, list):
            for incidente in incidentes:
                if not isinstance(incidente, dict):
                    continue
                nested_rows.append(
                    {
                        **incidente,
                        "idJuicio": incidente.get("idJuicio") or id_juicio,
                        "idJudicatura": incidente.get("idJudicatura") or incidente.get("idJudicaturaDestino") or row.get("idJudicatura"),
                        "nombreJudicatura": incidente.get("nombreJudicatura") or row.get("nombreJudicatura") or "",
                    }
                )
        elif {"idMovimientoJuicioIncidente", "idIncidenteJudicatura"} & set(row):
            nested_rows.append(row)

    if nested_rows:
        rows = nested_rows
    return [normalize_incidente(row, id_juicio) for row in rows if isinstance(row, dict)]


def classify_httpx_error(exc: Exception, stage: str) -> ApiError:
    message = str(exc) or None
    if isinstance(exc, httpx.TimeoutException):
        return ApiError(ErrorCode.SATJE_TIMEOUT, stage, message=message, status_code=504)
    if isinstance(exc, httpx.ConnectError):
        reason = str(exc).lower()
        if "name or service not known" in reason or "temporary failure in name resolution" in reason:
            return ApiError(ErrorCode.SATJE_DNS_ERROR, stage, message=message, status_code=502)
        if "ssl" in reason or "tls" in reason or "certificate" in reason:
            return ApiError(ErrorCode.SATJE_TLS_ERROR, stage, message=message, status_code=502)
        return ApiError(ErrorCode.SATJE_CONNECTION_ERROR, stage, message=message, status_code=502)
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        text = exc.response.text[:300].lower()
        if status in {401, 403, 429}:
            return ApiError(ErrorCode.SATJE_BLOCKED, stage, status_code=502)
        if "captcha" in text:
            return ApiError(ErrorCode.SATJE_CAPTCHA_REQUIRED, stage, status_code=502)
    return ApiError(ErrorCode.SATJE_CONNECTION_ERROR, stage, message=message, status_code=502)


class SatjeLiveClient(SatjeClient):
    mode = "live"

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=settings.source_base_url,
            timeout=settings.request_timeout_seconds,
            headers=SATJE_HEADERS,
            follow_redirects=True,
        )

    async def _json_or_error(self, response: httpx.Response, stage: str) -> Any:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise classify_httpx_error(exc, stage) from exc
        content_type = response.headers.get("content-type", "")
        try:
            return response.json()
        except ValueError as exc:
            if "html" in content_type or "captcha" in response.text.lower():
                raise ApiError(ErrorCode.SATJE_CAPTCHA_REQUIRED, stage, status_code=502) from exc
            raise ApiError(ErrorCode.SATJE_INVALID_RESPONSE, stage, status_code=502) from exc

    async def buscar_causas_por_cedula(
        self,
        cedula: str,
        *,
        role: str,
        page: int,
        size: int,
    ) -> Any:
        payload = buscar_causas_payload(cedula, role=role, page=page, size=size)
        params = {"page": page, "size": size}
        try:
            async with self._client() as client:
                response = await client.post(SATJE_BUSCAR_CAUSAS_PATH, json=payload, params=params)
                return await self._json_or_error(response, "buscarCausas")
        except ApiError:
            raise
        except Exception as exc:
            raise classify_httpx_error(exc, "buscarCausas") from exc

    async def obtener_incidentes_por_juicio(self, id_juicio: str) -> Any:
        try:
            async with self._client() as client:
                response = await client.get(SATJE_INCIDENTES_PATH.format(id_juicio=id_juicio))
                return await self._json_or_error(response, "getIncidenteJudicatura")
        except ApiError:
            raise
        except Exception as exc:
            raise classify_httpx_error(exc, "getIncidenteJudicatura") from exc

    async def obtener_actuaciones(self, payload: dict[str, Any]) -> Any:
        try:
            async with self._client() as client:
                response = await client.post(SATJE_ACTUACIONES_PATH, json=payload)
                return await self._json_or_error(response, "actuacionesJudiciales")
        except ApiError:
            raise
        except Exception as exc:
            raise classify_httpx_error(exc, "actuacionesJudiciales") from exc

    async def obtener_documento_hba(self, code: str) -> dict[str, Any]:
        clean_code = code.strip()
        if not clean_code:
            raise ApiError(ErrorCode.VALIDATION_ERROR, "documentHba", status_code=422)
        try:
            async with self._client() as client:
                response = await client.get(
                    SATJE_DOCUMENT_HBA_PATH,
                    params={"code": clean_code},
                    headers={**SATJE_HEADERS, "Accept": "*/*"},
                )
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    raise classify_httpx_error(exc, "documentHba") from exc
                return {
                    "contentType": response.headers.get("content-type"),
                    "contentLength": len(response.content),
                    "headers": {
                        "content-disposition": response.headers.get("content-disposition"),
                        "date": response.headers.get("date"),
                    },
                    "bytes": response.content,
                }
        except ApiError:
            raise
        except Exception as exc:
            raise classify_httpx_error(exc, "documentHba") from exc

    async def obtener_anexos_actuacion(self, payload: dict[str, Any]) -> Any:
        try:
            async with self._client() as client:
                response = await client.post(SATJE_ANEXOS_PATH, json=payload)
                return await self._json_or_error(response, "documentosAnexos")
        except ApiError:
            raise
        except Exception as exc:
            raise classify_httpx_error(exc, "documentosAnexos") from exc

    async def healthcheck(self) -> dict[str, Any]:
        host = httpx.URL(settings.source_base_url).host or "api.funcionjudicial.gob.ec"
        result: dict[str, Any] = {"mode": self.mode, "host": host, "available": False}
        try:
            result["addresses"] = [item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)]
            with socket.create_connection((host, 443), timeout=min(settings.request_timeout_seconds, 5)) as sock:
                with ssl.create_default_context().wrap_socket(sock, server_hostname=host):
                    result["available"] = True
        except Exception as exc:
            result["error"] = exc.__class__.__name__
            result["message"] = str(exc)
        return result


class _RemoteConnectorClient(SatjeClient):
    """Shared retry/circuit-breaker/metrics plumbing for the live SATJE connectors.

    Subclasses only differ in where the connector lives (`_connector_url`),
    how they authenticate (`_request_headers`), and how the actor/worker
    wraps its response (`_unwrap_response`, `_extra_params`, `_metrics_meta`).
    """

    mode = "live"
    backend_name: str = ""

    def _connector_url(self) -> str:
        raise NotImplementedError

    def _request_headers(self) -> dict[str, str]:
        raise NotImplementedError

    def _extra_params(self) -> dict[str, Any] | None:
        return None

    def _unwrap_response(self, raw: Any, operation: str) -> Any:
        return raw

    def _metrics_meta(self) -> dict[str, Any]:
        return {}

    async def _call_connector(self, operation: str, payload: dict[str, Any]) -> Any:
        _circuit_breaker.ensure_available()
        body = {
            "operation": operation,
            "timeoutMs": settings.request_timeout_seconds * 1000,
            "connectorToken": settings.satje_connector_internal_token,
            "requestId": current_request_id(),
            **payload,
        }
        headers = self._request_headers()
        attempts = max(1, settings.satje_connector_retry_attempts)
        last_error: ApiError | None = None
        started = time.perf_counter()

        async with _get_connector_semaphore():
            for attempt in range(1, attempts + 1):
                try:
                    async with httpx.AsyncClient(timeout=settings.satje_connector_timeout_seconds) as client:
                        response = await client.post(
                            self._connector_url(),
                            params=self._extra_params(),
                            headers=headers,
                            json=body,
                        )
                        response.raise_for_status()
                        raw = response.json()

                    item = self._unwrap_response(raw, operation)
                    if not isinstance(item, dict) or item.get("success") is not True:
                        error = item.get("error") if isinstance(item, dict) else item
                        code = ErrorCode.SATJE_INVALID_RESPONSE
                        if isinstance(error, dict) and error.get("code") in ErrorCode._value2member_map_:
                            code = ErrorCode(error["code"])
                        raise ApiError(
                            code,
                            operation,
                            message=str(error),
                            status_code=504 if code == ErrorCode.SATJE_TIMEOUT else 502,
                        )

                    _circuit_breaker.record_success()
                    record_metric(
                        request_id=current_request_id(),
                        stage=operation,
                        backend=self.backend_name,
                        mode=self.mode,
                        status="ok",
                        duration_ms=round((time.perf_counter() - started) * 1000, 2),
                        retry_count=attempt - 1,
                        meta=self._metrics_meta(),
                    )
                    return item.get("data")
                except httpx.HTTPStatusError as exc:
                    last_error = classify_httpx_error(exc, operation)
                except ApiError as exc:
                    last_error = exc
                except Exception as exc:
                    last_error = classify_httpx_error(exc, operation)

                if attempt < attempts and last_error.retryable:
                    await asyncio.sleep(settings.satje_connector_backoff_seconds * attempt)
                    continue
                break

        _circuit_breaker.record_failure()
        error = last_error or ApiError(ErrorCode.SATJE_CONNECTION_ERROR, operation)
        record_metric(
            request_id=current_request_id(),
            stage=operation,
            backend=self.backend_name,
            mode=self.mode,
            status="error",
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
            error_code=error.code.value,
            retry_count=max(0, attempts - 1),
            meta=self._metrics_meta(),
        )
        raise error

    async def buscar_causas_por_cedula(
        self,
        cedula: str,
        *,
        role: str,
        page: int,
        size: int,
    ) -> Any:
        return await self._call_connector(
            "buscarCausas",
            {
                "page": page,
                "size": size,
                "payload": buscar_causas_payload(cedula, role=role, page=page, size=size),
            },
        )

    async def obtener_incidentes_por_juicio(self, id_juicio: str) -> Any:
        return await self._call_connector("getIncidenteJudicatura", {"idJuicio": id_juicio})

    async def obtener_actuaciones(self, payload: dict[str, Any]) -> Any:
        return await self._call_connector("actuacionesJudiciales", {"payload": payload})

    async def obtener_documento_hba(self, code: str) -> dict[str, Any]:
        item = await self._call_connector("documentHba", {"code": code.strip()})
        if not isinstance(item, dict):
            raise ApiError(ErrorCode.SATJE_INVALID_RESPONSE, "documentHba", status_code=502)
        encoded = item.get("base64")
        if not isinstance(encoded, str) or not encoded:
            raise ApiError(ErrorCode.SATJE_INVALID_RESPONSE, "documentHba", status_code=502)
        try:
            pdf_bytes = base64.b64decode(encoded, validate=True)
        except Exception as exc:
            raise ApiError(ErrorCode.SATJE_INVALID_RESPONSE, "documentHba", status_code=502) from exc
        return {
            "contentType": item.get("contentType"),
            "contentLength": item.get("contentLength") or len(pdf_bytes),
            "headers": item.get("headers") if isinstance(item.get("headers"), dict) else {},
            "bytes": pdf_bytes,
        }

    async def obtener_anexos_actuacion(self, payload: dict[str, Any]) -> Any:
        return await self._call_connector("documentosAnexos", {"payload": payload})

    async def healthcheck(self) -> dict[str, Any]:
        result = {"mode": self.mode, "backend": self.backend_name, "available": False}
        try:
            data = await self.obtener_incidentes_por_juicio("01371201700497")
            result["available"] = bool(extract_incidentes(data, "01371201700497"))
        except Exception as exc:
            result["error"] = exc.__class__.__name__
            result["message"] = str(exc)
        return result


class SatjeApifyConnectorClient(_RemoteConnectorClient):
    backend_name = "apify_actor"

    def _connector_url(self) -> str:
        actor_id = settings.satje_connector_actor_id.strip()
        if not actor_id:
            raise ApiError(
                ErrorCode.INTERNAL_ERROR,
                "satje_connector",
                message="SATJE_CONNECTOR_ACTOR_ID no esta configurado.",
                status_code=500,
            )
        return f"https://api.apify.com/v2/acts/{quote(actor_id, safe='')}/run-sync-get-dataset-items"

    def _request_headers(self) -> dict[str, str]:
        token = settings.satje_connector_api_token.strip()
        if not token:
            raise ApiError(
                ErrorCode.INTERNAL_ERROR,
                "satje_connector",
                message="SATJE_CONNECTOR_API_TOKEN no esta configurado.",
                status_code=500,
            )
        return {"Authorization": f"Bearer {token}"}

    def _extra_params(self) -> dict[str, Any] | None:
        return {"memory": 256, "timeout": settings.satje_connector_timeout_seconds}

    def _unwrap_response(self, raw: Any, operation: str) -> Any:
        if not isinstance(raw, list) or not raw:
            raise ApiError(ErrorCode.SATJE_INVALID_RESPONSE, operation, status_code=502)
        return raw[0]

    def _metrics_meta(self) -> dict[str, Any]:
        return {"actorRunMode": "run-sync-get-dataset-items"}


class SatjeAwsLambdaConnectorClient(_RemoteConnectorClient):
    backend_name = "aws_lambda"

    def _connector_url(self) -> str:
        url = settings.satje_lambda_function_url.strip()
        if not url:
            raise ApiError(
                ErrorCode.INTERNAL_ERROR,
                "satje_lambda_connector",
                message="SATJE_LAMBDA_FUNCTION_URL no esta configurado.",
                status_code=500,
            )
        return url

    def _request_headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 satje-api/1.0",
        }
        token = settings.satje_lambda_api_token.strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _metrics_meta(self) -> dict[str, Any]:
        return {"connector": "lambda_function_url"}


class SatjeCloudflareWorkerConnectorClient(_RemoteConnectorClient):
    backend_name = "cloudflare_worker"

    def _connector_url(self) -> str:
        url = settings.satje_cloudflare_worker_url.strip()
        if not url:
            raise ApiError(
                ErrorCode.INTERNAL_ERROR,
                "satje_cloudflare_connector",
                message="SATJE_CLOUDFLARE_WORKER_URL no esta configurado.",
                status_code=500,
            )
        return url

    def _request_headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 satje-api/1.0",
        }
        token = settings.satje_cloudflare_api_token.strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _metrics_meta(self) -> dict[str, Any]:
        return {"connector": "cloudflare_worker"}


class SatjeFixtureClient(SatjeClient):
    mode = "fixture"

    def _read_json(self, filename: str) -> Any:
        return json.loads((EXAMPLES_DIR / filename).read_text(encoding="utf-8"))

    async def buscar_causas_por_cedula(
        self,
        cedula: str,
        *,
        role: str,
        page: int,
        size: int,
    ) -> Any:
        if cedula != "0104270855" or role != "actor":
            return []
        data = self._read_json("buscar-causas-response.example.json")
        start = (page - 1) * size
        return data[start : start + size]

    async def obtener_incidentes_por_juicio(self, id_juicio: str) -> Any:
        if str(id_juicio).strip() != "01371201700497":
            return []
        return self._read_json("incidentes-response.example.json")

    async def obtener_actuaciones(self, payload: dict[str, Any]) -> Any:
        canonical = self._read_json("actuaciones-request.payload.json")
        if str(payload.get("idJuicio")).strip() != str(canonical.get("idJuicio")).strip():
            return []
        return self._read_json("actuaciones-response.example.json")

    async def obtener_documento_hba(self, code: str) -> dict[str, Any]:
        known_code = "20251029-102848057652-593792259-1617253577"
        if code.strip() != known_code:
            raise ApiError(ErrorCode.ACTUATIONS_NOT_FOUND, "documentHba", status_code=404)
        path = ARTIFACTS_DIR / "satje_hba_20251029_102848057652_593792259_1617253577.pdf"
        return {
            "contentType": "application/pdf",
            "contentLength": path.stat().st_size,
            "headers": {"content-disposition": path.name},
            "bytes": path.read_bytes(),
        }


def get_satje_client() -> SatjeClient:
    mode = settings.effective_satje_mode
    if mode in {"live", "official"}:
        if settings.effective_satje_live_backend in {"cloudflare", "cloudflare_worker", "worker"}:
            return SatjeCloudflareWorkerConnectorClient()
        if settings.effective_satje_live_backend in {"aws_lambda", "lambda", "function_url"}:
            return SatjeAwsLambdaConnectorClient()
        if settings.effective_satje_live_backend in {"apify", "apify_actor", "connector"}:
            return SatjeApifyConnectorClient()
        return SatjeLiveClient()
    if mode in {"fixture", "mock"}:
        return SatjeFixtureClient()
    raise ApiError(
        ErrorCode.INTERNAL_ERROR,
        "satje_mode",
        message=f"SATJE_MODE invalido: {settings.satje_mode}",
        status_code=500,
    )
